import { type AgentRun, type StopReason } from '../../entities/agent-run';
import { AgentStepLimitError, DomainError, LlmRefusalError } from '../../entities/errors/domain-errors';
import { REPORT_GUARDRAILS } from '../../entities/policies/agent-guardrails';
import { checkNumberFidelity, maskPersonalData } from '../../entities/policies/number-fidelity';
import type { GeneratedReport } from '../../entities/report';
import { AgentLoop } from '../agents/agent-loop';
import type { LlmMessage, LlmPort, LlmPricing } from '../ports/llm.port';
import type { McpClientFactory } from '../ports/mcp-client.port';
import type { AppLogger, Clock, PromptCatalog } from '../ports/misc';
import type { AgentRunRepository, ReportRepository } from '../ports/repositories';
import type { ReportFinalizer } from './report-finalizer';
import { COMPOSE_SCHEMA, type ComposedReport, parseComposed } from './report-schemas';

/** Read-only tools the LLM may use. `raise_alert` is never offered (A4); `generate_report` is not needed (the agent persists itself). */
export const REPORT_AGENT_TOOLS = [
  'detect_anomalies',
  'get_content_stats',
  'get_credit_stats',
  'get_platform_kpis',
  'get_registration_stats',
  'get_service_health',
  'get_top_credit_spenders',
  'list_events',
  'list_failed_sagas',
  'list_flagged_content',
  'list_recent_registrations',
] as const;

export interface ReportAgentOptions {
  maxSteps: number;
  maxTokens: number;
}

/** ReportAgent (UC-19): plan + collect through MCP tools -> dataset -> markdown -> chart intent -> audio script -> TTS -> READY. */
export class GenerateReportUseCase {
  private readonly loop: AgentLoop;

  constructor(
    private readonly llm: LlmPort,
    private readonly mcp: McpClientFactory,
    private readonly reports: ReportRepository,
    private readonly runs: AgentRunRepository,
    private readonly finalizer: ReportFinalizer,
    private readonly prompts: PromptCatalog,
    private readonly clock: Clock,
    private readonly logger: AppLogger,
    pricing: LlmPricing,
    private readonly options: ReportAgentOptions,
  ) {
    this.loop = new AgentLoop(llm, runs, clock, pricing);
  }

  async execute(reportId: string): Promise<void> {
    const report = await this.reports.findById(reportId);
    if (!report || report.status === 'READY' || report.status === 'FAILED') return;
    const stored = report.agentRunId ? await this.runs.findById(report.agentRunId) : null;
    if (!stored) {
      await this.finalizer.fail(report, 'AGENT_RUN_MISSING');
      return;
    }
    const run = stored.run;
    const running: GeneratedReport = { ...report, status: 'RUNNING' };
    await this.reports.save(running);
    let mcp: Awaited<ReturnType<McpClientFactory['create']>> | undefined;
    try {
      mcp = await this.mcp.create({ actorId: report.requestedBy, correlationId: run.id });
      const allTools = await mcp.listTools();
      const tools = allTools.filter((t) => (REPORT_AGENT_TOOLS as readonly string[]).includes(t.name)).sort((a, b) => a.name.localeCompare(b.name));
      const today = this.clock.now().toISOString().slice(0, 10);
      const system = this.prompts.system('report', report.locale);
      const first: LlmMessage = {
        role: 'user',
        content: [{ type: 'text', text: report.locale === 'es' ? `Fecha de hoy: ${today} (UTC).\nPregunta: "${report.question}"` : `Today's date: ${today} (UTC).\nQuestion: "${report.question}"` }],
      };
      const meta = { question: report.question, today };
      const { messages, toolResults } = await this.loop.run({
        run,
        locale: report.locale,
        system,
        messages: [first],
        tools,
        limits: REPORT_GUARDRAILS(this.options.maxSteps, this.options.maxTokens),
        mcp,
        meta,
      });

      let composed = await this.compose(run, report, system, messages, meta);
      let fidelity = checkNumberFidelity(composed.markdown, composed.dataset, toolResults);
      let warning = false;
      if (!fidelity.ok) {
        this.logger.warn('number fidelity failed; asking for one correction', { reportId, unsupported: fidelity.unsupported.slice(0, 5) });
        composed = await this.compose(run, report, system, messages, meta, fidelity.unsupported);
        fidelity = checkNumberFidelity(composed.markdown, composed.dataset, toolResults);
        warning = !fidelity.ok;
      }
      composed.markdown = maskPersonalData(composed.markdown);
      const audioScript = await this.audioScript(run, report, composed.markdown);
      await this.finalizer.finish(report, {
        title: composed.title,
        markdown: composed.markdown,
        dataset: composed.dataset,
        chartIntent: composed.chartIntent,
        audioScript,
        fidelityWarning: warning,
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

  private async compose(run: AgentRun, report: GeneratedReport, system: string, history: LlmMessage[], meta: { question?: string; today?: string }, unsupported?: number[]): Promise<ComposedReport> {
    const ask = unsupported
      ? report.locale === 'es'
        ? `Corrige el reporte: estas cifras no están respaldadas por los datos: ${unsupported.join(', ')}. Usa solo cifras presentes en los resultados de las herramientas.`
        : `Fix the report: these figures are not backed by the data: ${unsupported.join(', ')}. Only use figures present in the tool results.`
      : this.prompts.compose(report.locale, report.question);
    const messages: LlmMessage[] = [...history, { role: 'user', content: [{ type: 'text', text: ask }] }];
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.llm.complete({
        tier: 'smart',
        purpose: unsupported ? 'correct' : 'compose',
        locale: report.locale,
        system,
        messages,
        maxTokens: 4096,
        responseSchema: COMPOSE_SCHEMA,
        effort: 'low',
        meta,
      });
      this.account(run, res.usage, res.model);
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

  private async audioScript(run: AgentRun, report: GeneratedReport, markdown: string): Promise<string | null> {
    try {
      const res = await this.llm.complete({
        tier: 'fast',
        purpose: 'audio_script',
        locale: report.locale,
        system: this.prompts.audio(report.locale),
        messages: [{ role: 'user', content: [{ type: 'text', text: markdown }] }],
        maxTokens: 700,
        effort: 'low',
        meta: { question: report.question },
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
