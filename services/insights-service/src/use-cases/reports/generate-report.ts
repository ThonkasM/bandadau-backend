import { type AgentRun, noteEngine, type RunVerification, type StopReason } from '../../entities/agent-run';
import { AgentStepLimitError, DomainError, LlmRefusalError } from '../../entities/errors/domain-errors';
import { REPORT_GUARDRAILS } from '../../entities/policies/agent-guardrails';
import { hasProcessChatter, isSummaryRequest, plainAnswer, startsWithAnswer } from '../../entities/policies/answer-quality';
import { deriveDataset } from '../../entities/policies/dataset-derivation';
import { checkNumberFidelity, type FidelityContext, maskPersonalData } from '../../entities/policies/number-fidelity';
import { dateContext, describeDateContext } from '../../entities/policies/relative-dates';
import type { GeneratedReport, ReportDataset } from '../../entities/report';
import { AgentLoop } from '../agents/agent-loop';
import type { LlmBlock, LlmMessage, LlmPort, LlmPricing } from '../ports/llm.port';
import type { LlmEnginesPort } from '../ports/llm-engines.port';
import type { McpClientFactory } from '../ports/mcp-client.port';
import type { AppLogger, Clock, PromptCatalog } from '../ports/misc';
import type { AgentRunRepository, ReportRepository } from '../ports/repositories';
import type { ReportFinalizer } from './report-finalizer';
import { COMPOSE_SCHEMA, type ComposedReport, parseComposed } from './report-schemas';

/** Read-only tools the LLM may use. `raise_alert` is never offered (A4); `generate_report` is not needed (the agent persists itself). */
export const REPORT_AGENT_TOOLS = [
  'calculate',
  'detect_anomalies',
  'get_content_stats',
  'get_content_rankings',
  'get_credit_stats',
  'get_event_ranking',
  'get_platform_kpis',
  'get_registration_stats',
  'get_service_health',
  'get_ticket_stats',
  'get_top_credit_spenders',
  'get_user_stats',
  'get_wallet_overview',
  'list_events',
  'list_failed_sagas',
  'list_flagged_content',
  'list_recent_registrations',
] as const;

/** Q&A mode: at most this many rounds of tool calls (+1 final answer) and this output budget per LLM call. */
export const QA_MAX_TOOL_ROUNDS = 4;
export const QA_MAX_OUTPUT_TOKENS = 700;

interface Draft {
  title: string;
  markdown: string;
  dataset: ReportDataset | null;
  chartIntent: ComposedReport['chartIntent'];
}
interface Check {
  unsupported: number[];
  chatter: boolean;
  notAnAnswer: boolean;
}
const needsRewrite = (c: Check): boolean => c.unsupported.length > 0 || c.chatter || c.notAnAnswer;
const withTag = (model: string | null, tag: string): string | null => (model && !model.includes(tag) ? `${model}${tag}` : model);

export interface ReportAgentOptions {
  maxSteps: number;
  maxTokens: number;
}

/** ReportAgent (UC-19): plan + collect through MCP tools -> dataset -> markdown -> chart intent -> audio script -> TTS -> READY. */
export class GenerateReportUseCase {
  constructor(
    private readonly llm: LlmPort,
    private readonly mcp: McpClientFactory,
    private readonly reports: ReportRepository,
    private readonly runs: AgentRunRepository,
    private readonly finalizer: ReportFinalizer,
    private readonly prompts: PromptCatalog,
    private readonly clock: Clock,
    private readonly logger: AppLogger,
    private readonly pricing: LlmPricing,
    private readonly options: ReportAgentOptions,
    /** When present, the engine asked for by each report (`requestedEngine`) is resolved here; otherwise `llm` serves every report. */
    private readonly engines?: LlmEnginesPort,
  ) {}

  async execute(reportId: string): Promise<void> {
    const report = await this.reports.findById(reportId);
    if (!report || report.status === 'READY' || report.status === 'FAILED') return;
    const stored = report.agentRunId ? await this.runs.findById(report.agentRunId) : null;
    if (!stored) {
      await this.finalizer.fail(report, 'AGENT_RUN_MISSING');
      return;
    }
    const run = stored.run;
    const llm = this.engines ? this.engines.select(report.requestedEngine ?? 'AUTO', report.locale) : this.llm;
    const loop = new AgentLoop(llm, this.runs, this.clock, this.pricing);
    const running: GeneratedReport = { ...report, status: 'RUNNING' };
    await this.reports.save(running);
    let mcp: Awaited<ReturnType<McpClientFactory['create']>> | undefined;
    try {
      mcp = await this.mcp.create({ actorId: report.requestedBy, correlationId: run.id });
      const allTools = await mcp.listTools();
      const tools = allTools.filter((t) => (REPORT_AGENT_TOOLS as readonly string[]).includes(t.name)).sort((a, b) => a.name.localeCompare(b.name));
      const today = this.clock.now().toISOString().slice(0, 10);
      const qa = !isSummaryRequest(report.question);
      const es = report.locale === 'es';
      const system = qa ? this.prompts.qaSystem(report.locale) : this.prompts.system('report', report.locale);
      const header = es ? `Fecha de hoy: ${today} (UTC).` : `Today's date: ${today} (UTC).`;
      const dates = qa ? `\n${describeDateContext(report.locale, dateContext(today))}` : '';
      const first: LlmMessage = { role: 'user', content: [{ type: 'text', text: `${header}${dates}\n${es ? 'Pregunta' : 'Question'}: "${report.question}"` }] };
      const meta = { question: report.question, today };
      const { messages, toolResults, toolCalls } = await loop.run({
        run,
        locale: report.locale,
        system,
        messages: [first],
        tools,
        limits: REPORT_GUARDRAILS(qa ? Math.min(this.options.maxSteps, QA_MAX_TOOL_ROUNDS + 1) : this.options.maxSteps, this.options.maxTokens),
        mcp,
        meta,
        ...(qa ? { maxOutputTokens: QA_MAX_OUTPUT_TOKENS } : {}),
      });

      const fctx: FidelityContext = { question: report.question, today, toolCalls };
      // an agent engine writes the final Q&A text itself in the last loop turn; the others (hybrid, deterministic) go through the compose step
      const direct = qa && run.engineMode === 'AGENT' ? this.directDraft(messages, toolResults, report) : null;
      let draft: Draft = direct ?? (await this.compose(llm, run, report, system, messages, meta, qa));
      const baseModel = run.model; // who wrote the first draft; tags below say what happened afterwards
      let check = this.check(draft, direct !== null, toolResults, fctx, qa);
      const firstUnsupported = check.unsupported;
      let retries = 0;
      if (needsRewrite(check)) {
        // ONE silent regeneration with an internal instruction; the user never sees an apology
        retries = 1;
        this.logger.warn('final text failed verification; regenerating silently', { reportId, unsupported: check.unsupported.slice(0, 5), chatter: check.chatter, notAnAnswer: check.notAnAnswer });
        draft = direct ? await this.rewriteDirect(llm, run, report, system, messages, draft, check, meta) : await this.compose(llm, run, report, system, messages, meta, qa, { draft, check });
        check = this.check(draft, direct !== null, toolResults, fctx, qa);
        run.model = withTag(baseModel, '+retry');
      }
      if ((check.unsupported.length > 0 || check.chatter) && this.engines) {
        // last resort: the deterministic draft built from the real tool data
        draft = await this.compose(this.engines.select('STUB', report.locale), run, report, system, messages, meta, qa);
        check = this.check(draft, false, toolResults, fctx, qa);
        run.model = withTag(baseModel, '+stub-fallback');
      }
      const passed = check.unsupported.length === 0 && !check.chatter;
      const verification: RunVerification = { passed, retries, unsupportedNumbers: (retries > 0 ? firstUnsupported : check.unsupported).slice(0, 20) };
      run.verification = verification;
      const composed = draft;
      const warning = !passed;
      composed.markdown = maskPersonalData(composed.markdown);
      const audioScript = qa ? plainAnswer(composed.markdown) || null : await this.audioScript(llm, run, report, composed.markdown);
      await this.finalizer.finish(report, {
        title: composed.title,
        markdown: composed.markdown,
        dataset: composed.dataset,
        chartIntent: composed.chartIntent,
        audioScript,
        fidelityWarning: warning,
        engine: run.engine ?? null,
        model: run.model,
      });
      await this.closeRun(run, 'SUCCEEDED', 'COMPLETED');
    } catch (error) {
      const code = error instanceof DomainError ? error.code : 'AGENT_ERROR';
      const stop: StopReason = error instanceof AgentStepLimitError ? error.stopReason : 'ERROR';
      this.logger.error('report agent failed', { reportId, code, error: (error as Error).message });
      run.error = { code, message: (error as Error).message.slice(0, 300) };
      await this.closeRun(run, error instanceof AgentStepLimitError ? 'ABORTED' : 'FAILED', run.stopReason ?? stop);
      await this.finalizer.fail(report, code);
    } finally {
      await mcp?.close().catch(() => undefined);
    }
  }

  private check(draft: Draft, noDataset: boolean, toolResults: unknown[], ctx: FidelityContext, qa: boolean): Check {
    // a model-written final text carries no dataset of its own: only tool results (and calculate) back its figures
    const fidelity = checkNumberFidelity(draft.markdown, noDataset ? null : draft.dataset, toolResults, ctx);
    return { unsupported: fidelity.unsupported, chatter: hasProcessChatter(draft.markdown), notAnAnswer: qa && !startsWithAnswer(draft.markdown) };
  }

  /** Final text written by the agent engine in the last loop turn (null when there is none usable: the compose step runs instead). */
  private directDraft(messages: LlmMessage[], toolResults: unknown[], report: GeneratedReport): Draft | null {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return null;
    const text = last.content.filter((b): b is Extract<LlmBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/, '').trim();
    if (text.length < 8 || text.startsWith('{')) return null;
    const derived = deriveDataset(toolResults);
    return {
      title: report.locale === 'es' ? 'Respuesta de Bandada U' : 'Bandada U answer',
      markdown: text,
      dataset: derived?.dataset ?? null,
      chartIntent: derived?.chart ?? { type: 'table' },
    };
  }

  private async rewriteDirect(llm: LlmPort, run: AgentRun, report: GeneratedReport, system: string, history: LlmMessage[], previous: Draft, check: Check, meta: { question?: string; today?: string }): Promise<Draft> {
    const ask = this.prompts.rewrite(report.locale, check.unsupported, { chatter: check.chatter, notAnAnswer: check.notAnAnswer });
    const res = await llm.complete({
      tier: 'smart',
      purpose: 'correct',
      locale: report.locale,
      system,
      messages: [...history, { role: 'user', content: [{ type: 'text', text: ask }] }],
      maxTokens: QA_MAX_OUTPUT_TOKENS,
      effort: 'low',
      meta,
      sessionId: run.id,
    });
    this.account(run, res.usage, res.model);
    noteEngine(run, res);
    if (res.stopReason === 'refusal') throw new LlmRefusalError();
    const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/, '').trim();
    return text.length >= 8 && !text.startsWith('{') ? { ...previous, markdown: text } : previous;
  }

  private async compose(llm: LlmPort, run: AgentRun, report: GeneratedReport, system: string, history: LlmMessage[], meta: { question?: string; today?: string }, qa: boolean, retry?: { draft: Draft; check: Check }): Promise<Draft> {
    const base = qa ? this.prompts.qaCompose(report.locale, report.question) : this.prompts.compose(report.locale, report.question);
    const messages: LlmMessage[] = [...history, { role: 'user', content: [{ type: 'text', text: base }] }];
    if (retry) {
      const prev: ComposedReport = { title: retry.draft.title, markdown: retry.draft.markdown, dataset: retry.draft.dataset ?? { columns: [], rows: [] }, chartIntent: retry.draft.chartIntent };
      messages.push(
        { role: 'assistant', content: [{ type: 'text', text: JSON.stringify(prev) }] },
        { role: 'user', content: [{ type: 'text', text: this.prompts.rewrite(report.locale, retry.check.unsupported, { chatter: retry.check.chatter, notAnAnswer: retry.check.notAnAnswer }) }] },
      );
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await llm.complete({
        tier: 'smart',
        purpose: retry ? 'correct' : 'compose',
        locale: report.locale,
        system,
        messages,
        maxTokens: qa ? QA_MAX_OUTPUT_TOKENS : 4096,
        responseSchema: COMPOSE_SCHEMA,
        effort: 'low',
        meta,
        sessionId: run.id,
      });
      this.account(run, res.usage, res.model);
      noteEngine(run, res);
      if (res.stopReason === 'refusal') throw new LlmRefusalError();
      const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
      try {
        return parseComposed(text);
      } catch (error) {
        messages.push({ role: 'assistant', content: [{ type: 'text', text }] }, { role: 'user', content: [{ type: 'text', text: `Invalid JSON (${(error as Error).message}). Reply with the JSON object only.` }] });
      }
    }
    throw new DomainError('LLM_INVALID_OUTPUT', 'The model did not return a valid report');
  }

  private async audioScript(llm: LlmPort, run: AgentRun, report: GeneratedReport, markdown: string): Promise<string | null> {
    try {
      const res = await llm.complete({
        tier: 'fast',
        purpose: 'audio_script',
        locale: report.locale,
        system: this.prompts.audio(report.locale),
        messages: [{ role: 'user', content: [{ type: 'text', text: markdown }] }],
        maxTokens: 700,
        effort: 'low',
        meta: { question: report.question },
        sessionId: run.id,
      });
      this.account(run, res.usage, run.model ?? res.model); // keep the model that wrote the answer (the audio script must not overwrite it)
      const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(' ').trim();
      return text.length > 0 ? maskPersonalData(text) : null;
    } catch (error) {
      this.logger.warn('audio script failed; report without audio', { error: (error as Error).message });
      return null;
    }
  }

  private account(run: AgentRun, usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }, model: string): void {
    run.llmSteps += 1;
    run.model = model;
    run.tokens.input += usage.inputTokens;
    run.tokens.output += usage.outputTokens;
    run.tokens.cacheRead += usage.cacheReadTokens;
    run.tokens.cacheWrite += usage.cacheWriteTokens;
  }

  private async closeRun(run: AgentRun, status: 'SUCCEEDED' | 'FAILED' | 'ABORTED', stop: StopReason): Promise<void> {
    run.status = status;
    run.stopReason = run.stopReason ?? stop;
    run.finishedAt = this.clock.now().toISOString();
    await this.runs.update(run);
  }
}
