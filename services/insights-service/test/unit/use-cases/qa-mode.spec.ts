import { newAgentRun } from '../../../src/entities/agent-run';
import { REPORT_GUARDRAILS } from '../../../src/entities/policies/agent-guardrails';
import { hasProcessChatter, isSummaryRequest, startsWithAnswer } from '../../../src/entities/policies/answer-quality';
import { deriveDataset } from '../../../src/entities/policies/dataset-derivation';
import { checkNumberFidelity } from '../../../src/entities/policies/number-fidelity';
import { dateContext, daysInRange } from '../../../src/entities/policies/relative-dates';
import { routeTools } from '../../../src/entities/policies/tool-routing';
import { StubLlmAdapter } from '../../../src/interface-adapters/gateways/llm/stub.adapter';
import { AgentLoop } from '../../../src/use-cases/agents/agent-loop';
import type { LlmPort, LlmRequest, LlmResponse, LlmToolDef } from '../../../src/use-cases/ports/llm.port';
import type { LlmEnginesPort } from '../../../src/use-cases/ports/llm-engines.port';
import { GenerateReportUseCase } from '../../../src/use-cases/reports/generate-report';
import { ReportFinalizer } from '../../../src/use-cases/reports/report-finalizer';
import { RequestReportUseCase } from '../../../src/use-cases/reports/request-report';
import { FakeClock, FakeMcp, fakePrompts, FakeTts, InlineJobs, MemReports, MemRuns, MemStorage, say, ScriptedLlm, SeqIds, silentLogger, toolUse } from '../../support/fakes';

const TOOLS: LlmToolDef[] = ['calculate', 'get_credit_stats', 'get_platform_kpis', 'get_registration_stats'].map((name) => ({ name, description: name, inputSchema: { type: 'object' } }));
const CREDITS = { from: '2026-10-15', to: '2026-10-15', groupBy: 'day', totals: { topUpCredits: 200, debitCredits: 105, refundCredits: 0, netCredits: 95 }, series: [{ date: '2026-10-15', topUpCredits: 200, debitCredits: 105 }] };
const REGS = { from: '2026-10-12', to: '2026-10-15', groupBy: 'day', totals: { confirmed: 11, failed: 1, cancelled: 0, pending: 0 }, rows: [{ key: '2026-10-12', confirmed: 4, failed: 0, cancelled: 0 }, { key: '2026-10-13', confirmed: 7, failed: 1, cancelled: 0 }] };

/** An agent-mode engine (OpenCode AGENT): responses carry engine/mode like the registry chain sets them. */
const asAgent = (r: LlmResponse): LlmResponse => ({ ...r, model: 'deepseek-v4.1-flash', engine: 'OPENCODE', mode: 'AGENT' });
class AsStub implements LlmPort {
  readonly provider = 'stub';
  readonly inner = new StubLlmAdapter();
  async complete(req: LlmRequest): Promise<LlmResponse> {
    return { ...(await this.inner.complete(req)), engine: 'STUB', mode: 'DETERMINISTIC' };
  }
}

function setup(llm: LlmPort, mcp = new FakeMcp({ get_credit_stats: CREDITS, get_registration_stats: REGS, calculate: (a: Record<string, unknown>) => ({ result: Array.isArray(a.values) ? (a.values as number[]).reduce((x, y) => x + y, 0) : 0 }) }, new Set(), TOOLS)) {
  const clock = new FakeClock();
  const reports = new MemReports();
  const runs = new MemRuns();
  const engines: LlmEnginesPort = { select: (e) => (e === 'STUB' ? new AsStub() : llm), list: async () => [] };
  const finalizer = new ReportFinalizer(reports, new FakeTts(true), new MemStorage(), clock, silentLogger);
  const generate = new GenerateReportUseCase(llm, mcp, reports, runs, finalizer, fakePrompts, clock, silentLogger, { inPerM: 2, outPerM: 10 }, { maxSteps: 8, maxTokens: 20_000 }, engines);
  const jobs = new InlineJobs();
  const request = new RequestReportUseCase(reports, runs, clock, new SeqIds(), jobs, fakePrompts, silentLogger, (id) => generate.execute(id));
  const ask = async (question: string, locale: 'es' | 'en' = 'es') => {
    const r = await request.execute({ question, locale, requestedBy: 'admin', defaultLocale: 'es' });
    await jobs.drain();
    return { report: (await reports.findById(r.reportId))!, run: (await runs.findById(r.agentRunId))!.run, steps: (await runs.findById(r.agentRunId))!.steps };
  };
  return { ask, mcp, llm };
}

const GOOD = 'Hoy se gastaron 105 créditos en inscripciones.\n\n## Detalle\n\n- Recargados: 200\n- Gastados: 105';
const agentScript = (final: string, ...more: ((req: LlmRequest) => LlmResponse)[]) => [
  () => asAgent(toolUse({ name: 'get_credit_stats', input: { from: '2026-10-15', to: '2026-10-15' } })),
  () => asAgent(say(final)),
  ...more,
];

describe('Q&A mode (agent engine)', () => {
  it('answers in two LLM calls: tools in one round, then the final text; no compose, no audio call; verification passes', async () => {
    const llm = new ScriptedLlm(agentScript(GOOD));
    const { ask } = setup(llm);
    const { report, run } = await ask('¿Cuántos créditos se gastaron hoy?');
    expect(llm.requests.map((r) => r.purpose)).toEqual(['collect', 'collect']);
    expect(llm.requests[0]!.system).toBe('system:qa:es');
    expect(llm.requests[0]!.maxTokens).toBeLessThanOrEqual(700);
    expect(report.markdown).toBe(GOOD);
    expect(report).toMatchObject({ status: 'READY', fidelityWarning: false, model: 'deepseek-v4.1-flash', engine: 'OPENCODE' });
    expect(run.verification).toEqual({ passed: true, retries: 0, unsupportedNumbers: [] });
    expect(report.dataset?.rows.length).toBeGreaterThan(0); // derived from the tool result
  });

  it('puts the resolved relative dates in the first user message (UTC)', async () => {
    const llm = new ScriptedLlm(agentScript(GOOD));
    await setup(llm).ask('¿Cuántos créditos se gastaron esta semana?');
    const text = JSON.stringify(llm.requests[0]!.messages[0]);
    expect(text).toContain('esta semana (lunes→hoy) 2026-10-12→2026-10-15');
    expect(text).toContain('semana pasada 2026-10-05→2026-10-11');
    expect(text).toContain('mes pasado 2026-09-01→2026-09-30');
  });

  it.each([
    ['días del período', 'En los últimos 30 días se gastaron 105 créditos.'],
    ['fecha en texto', 'El 15 de octubre de 2026 se gastaron 105 créditos.'],
    ['ranking y límite', 'Top 3: 1.º Ana con 105 créditos, 2.º Luis con 105 créditos y 3.º Eva con 105 créditos.'],
    ['rango de la pregunta', 'Entre el 15/10/2026 y el 15/10/2026 (1 día) se gastaron 105 créditos.'],
  ])('derived figure that the old verifier rejected passes: %s', async (_n, text) => {
    const llm = new ScriptedLlm(agentScript(text));
    const { ask } = setup(llm);
    const { report, run } = await ask('¿Cuántos créditos se gastaron hoy? Top 3');
    expect(report.markdown).toBe(text);
    expect(run.verification).toMatchObject({ passed: true, retries: 0 });
  });

  it('a percentage computed by calculate is accepted; the same percentage invented is not', async () => {
    const withCalc = new ScriptedLlm([
      () => asAgent(toolUse({ name: 'get_credit_stats', input: { from: '2026-10-15', to: '2026-10-15' } })),
      () => asAgent(toolUse({ name: 'calculate', input: { operation: 'SUM', values: [105, 200] } })),
      () => asAgent(say('Entre gastados y recargados suman 305 créditos.')),
    ]);
    expect((await setup(withCalc).ask('¿Cuánto suman los créditos de hoy?')).run.verification).toMatchObject({ passed: true, retries: 0 });
  });

  it('SILENT retry: an unsupported figure triggers ONE internal rewrite; the user sees the corrected answer, model gets +retry', async () => {
    const llm = new ScriptedLlm(agentScript('Hoy se gastaron 105 créditos, el 53.8 % de lo recargado.', () => asAgent(say(GOOD))));
    const { ask } = setup(llm);
    const { report, run } = await ask('¿Cuántos créditos se gastaron hoy?');
    expect(llm.requests).toHaveLength(3);
    expect(llm.requests[2]!.purpose).toBe('correct');
    expect(JSON.stringify(llm.requests[2]!.messages.at(-1))).toContain('rewrite:es:53.8');
    expect(report.markdown).toBe(GOOD);
    expect(report.model).toBe('deepseek-v4.1-flash+retry');
    expect(run.verification).toEqual({ passed: true, retries: 1, unsupportedNumbers: [53.8] });
    expect(report.fidelityWarning).toBe(false);
  });

  it.each([
    'Retiro la cifra 30 que aparecía en mi respuesta anterior. Hoy se gastaron 105 créditos.',
    'Tienes razón: las cifras señaladas no provienen de ninguna herramienta. Hoy se gastaron 105 créditos.',
    'Aclaro: en el reporte anterior no aparecía ninguna cifra "10". Hoy se gastaron 105 créditos.',
    'Revisé el reporte anterior contra los resultados. Hoy se gastaron 105 créditos.',
  ])('an apology is never shown: %s', async (apology) => {
    const llm = new ScriptedLlm(agentScript(apology, () => asAgent(say(GOOD))));
    const { report, run } = await setup(llm).ask('¿Cuántos créditos se gastaron hoy?');
    expect(report.markdown).toBe(GOOD);
    expect(run.verification).toMatchObject({ passed: true, retries: 1 });
  });

  it('a first line that is a preamble ("Período analizado: …") instead of the answer is regenerated', async () => {
    const llm = new ScriptedLlm(agentScript('**Período analizado:** 15/10/2026 a 15/10/2026\n\nSe gastaron 105 créditos.', () => asAgent(say(GOOD))));
    const { report } = await setup(llm).ask('¿Cuántos créditos se gastaron hoy?');
    expect(report.markdown).toBe(GOOD);
  });

  it('falls to the deterministic draft (never an apology) when the rewrite fails too: model +stub-fallback, engine STUB', async () => {
    const bad = 'Retiro la cifra 9999 de mi reporte anterior.';
    const llm = new ScriptedLlm(agentScript(bad, () => asAgent(say(bad))));
    const { report, run } = await setup(llm).ask('¿Cuántos créditos se gastaron hoy?');
    expect(report.markdown?.split('\n')[0]).toBe('Hoy se gastaron 105 créditos en inscripciones.');
    expect(hasProcessChatter(report.markdown ?? '')).toBe(false);
    expect(report.model).toBe('deepseek-v4.1-flash+stub-fallback');
    expect(report.engine).toBe('STUB');
    expect(run.verification).toMatchObject({ passed: true, retries: 1 });
    expect(run.verification?.unsupportedNumbers).toContain(9999);
  });

  it('caches identical tool calls within the run (one MCP call) and records them as cached', async () => {
    const llm = new ScriptedLlm([
      () => asAgent(toolUse({ name: 'get_credit_stats', input: { from: '2026-10-15', to: '2026-10-15' } })),
      () => asAgent(toolUse({ name: 'get_credit_stats', input: { to: '2026-10-15', from: '2026-10-15' } })),
      () => asAgent(say(GOOD)),
    ]);
    const { ask, mcp } = setup(llm);
    const { steps } = await ask('¿Cuántos créditos se gastaron hoy?');
    expect(mcp.calls).toHaveLength(1);
    expect(steps.filter((s) => s.kind === 'TOOL_CALL').map((s) => s.outputSummary?.startsWith('(cached)'))).toEqual([false, true]);
  });

  it('at most 4 rounds of tools in Q&A mode: the 5th LLM call has no tools and must answer (no AGENT_STEP_LIMIT)', async () => {
    const llm = new ScriptedLlm((req) => asAgent(req.tools?.length ? toolUse({ name: 'get_credit_stats', input: { from: '2026-10-15', to: '2026-10-15', groupBy: String(req.messages.length) } }) : say(GOOD)));
    const { ask } = setup(llm);
    const { report } = await ask('¿Cuántos créditos se gastaron hoy?');
    expect(llm.requests).toHaveLength(5);
    expect(llm.requests.map((r) => Boolean(r.tools?.length))).toEqual([true, true, true, true, false]);
    expect(report.status).toBe('READY');
    expect(report.markdown).toBe(GOOD);
  });

  it('does not regenerate when the engine is deterministic/hybrid (it would return the same draft): straight to the final check', async () => {
    const det = (r: LlmResponse): LlmResponse => ({ ...r, model: 'stub-deterministic-1', engine: 'STUB', mode: 'DETERMINISTIC' });
    const composed = { title: 'Respuesta', markdown: '## Reporte de la plataforma\n\nSe gastaron 105 créditos.', dataset: { columns: [{ name: 'm', type: 'string' }, { name: 'v', type: 'integer' }], rows: [['Gastados', 105]] }, chartIntent: { type: 'table' } };
    const llm = new ScriptedLlm([() => det(toolUse({ name: 'get_credit_stats', input: { from: '2026-10-15', to: '2026-10-15' } })), () => det(say('ok')), () => det(say(JSON.stringify(composed)))]);
    const { report, run } = await setup(llm).ask('¿Cuántos créditos se gastaron hoy?');
    expect(llm.requests.map((r) => r.purpose)).toEqual(['collect', 'collect', 'compose']);
    expect(run.verification).toEqual({ passed: true, retries: 0, unsupportedNumbers: [] });
    expect(report.model).toBe('stub-deterministic-1');
  });

  it('an explicit summary keeps the report format (report prompts, compose step, audio script call)', async () => {
    const composed = { title: 'Resumen de la semana', markdown: '## Resumen\n\nSe confirmaron 11 inscripciones.', dataset: { columns: [{ name: 'm', type: 'string' }, { name: 'v', type: 'integer' }], rows: [['Confirmadas', 11]] }, chartIntent: { type: 'table' } };
    const llm = new ScriptedLlm([
      () => asAgent(toolUse({ name: 'get_registration_stats', input: { from: '2026-10-12', to: '2026-10-15' } })),
      () => asAgent(say('ok')),
      (r: LlmRequest) => asAgent(r.purpose === 'audio_script' ? say('Se confirmaron once inscripciones.') : say(JSON.stringify(composed))),
    ]);
    const { report } = await setup(llm).ask('Dame un resumen de la semana');
    expect(llm.requests[0]!.system).toBe('system:report:es');
    expect(llm.requests.map((r) => r.purpose)).toEqual(['collect', 'collect', 'compose', 'audio_script']);
    expect(report.title).toBe('Resumen de la semana');
  });
});

describe('Q&A policies', () => {
  it('classifies explicit summaries vs questions', () => {
    for (const q of ['Dame un resumen de la semana', 'Genera un reporte de créditos', 'Give me a weekly report', 'Platform overview', 'Informe del mes']) expect(isSummaryRequest(q)).toBe(true);
    for (const q of ['¿Cuántos créditos se gastaron hoy?', '¿Cuántas denuncias abiertas hay?', 'What is the platform health?', 'Compara las inscripciones de esta semana con la semana pasada', '¿Quién publicó más esta semana?']) expect(isSummaryRequest(q)).toBe(false);
  });

  it('detects process chatter in es and en, and preambles that are not an answer', () => {
    for (const t of ['Retiro la cifra 30.', 'Aclaro primero: …', 'Tienes razón: las cifras', 'Revisé mi reporte anterior', 'You are right, sorry about that', 'In the previous report there was no 10', 'Lo siento, me equivoqué']) expect(hasProcessChatter(t)).toBe(true);
    for (const t of ['Hoy se gastaron 105 créditos.', 'No hay denuncias abiertas: 0 casos pendientes.', 'There were 12 registrations this week.']) expect(hasProcessChatter(t)).toBe(false);
    expect(startsWithAnswer('**Período analizado:** 12/10/2026 a 16/10/2026')).toBe(false);
    expect(startsWithAnswer('## Resumen de la plataforma')).toBe(false);
    expect(startsWithAnswer('Se registraron 12 inscripciones esta semana.')).toBe(true);
  });

  it('date context is resolved by code (Monday-based week, previous month, N-day lengths)', () => {
    const c = dateContext('2026-10-16'); // Friday
    expect(c.thisWeek).toEqual({ from: '2026-10-12', to: '2026-10-16' });
    expect(c.lastWeek).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(c.lastMonth).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(daysInRange(c.last30)).toBe(30);
    expect(dateContext('2026-01-05').lastMonth).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  describe('verifier: derived figures of the real battery', () => {
    const tool = { from: '2026-09-16', to: '2026-10-15', totals: { debitCredits: 160 }, items: [{ name: 'a', n: 5 }, { name: 'b', n: 4 }, { name: 'c', n: 3 }, { name: 'd', n: 2 }, { name: 'e', n: 1 }] };
    const ctx = { question: '¿Cuáles son los 3 hashtags más usados?', today: '2026-10-16', toolCalls: [{ name: 'get_content_rankings', input: { from: '2026-09-16', to: '2026-10-15', by: 'HASHTAGS', limit: 5 } }] };
    const ok = (md: string, results: unknown[] = [tool], c = ctx) => checkNumberFidelity(md, null, results, c).ok;
    it.each([
      'Entre el 16 de septiembre y el 15 de octubre de 2026 (30 días) se gastaron 160 créditos.',
      'Del 16/09/2026 al 15/10/2026: 160 créditos.',
      'Top 3: 1. a (5), 2. b (4), 3. c (3).',
      'Los 5 hashtags más usados suman datos de 2026.',
      'Hasta hoy, 16 de octubre, 160 créditos.',
    ])('accepts: %s', (md) => expect(ok(md)).toBe(true));
    it.each(['Se gastaron 53.8 % de los créditos recargados.', 'El promedio fue 17.5 créditos.', 'Fueron 9999 créditos.'])('rejects an invented derived figure: %s', (md) => expect(ok(md)).toBe(false));
    it('accepts a percentage that comes from calculate or a tool field', () => {
      expect(ok('El cambio fue de 33.3 %.', [tool, { result: 33.33 }])).toBe(true);
      expect(ok('Ocupación: 87.5 %.', [{ fillRate: 87.5 }])).toBe(true);
    });
  });

  it('derives a small dataset and chart from tool results', () => {
    const d = deriveDataset([{ items: [{ title: 'Taller', seatsTaken: 4, capacity: 10, eventId: 'x' }] }]);
    expect(d?.dataset.columns.map((c) => c.name)).toEqual(['title', 'seatsTaken', 'capacity']);
    expect(d?.chart).toMatchObject({ type: 'bar', x: 'title', y: 'seatsTaken' });
    expect(deriveDataset([{ total: 3 }])).toBeNull();
  });
});

describe('AgentLoop compaction', () => {
  it('sends compact tool definitions and results (no nulls, rounded figures, short arrays) while evidence keeps the full data', async () => {
    const llm = new ScriptedLlm([() => toolUse({ name: 'get_platform_kpis', input: {} }), () => say('ok')]);
    const run = newAgentRun({ id: 'c1', agent: 'REPORT', trigger: 'REPORT_REQUEST', requestedBy: 'u', locale: 'es', now: new Date().toISOString() });
    const long = 'x'.repeat(500);
    const out = await new AgentLoop(llm, new MemRuns(), new FakeClock(), { inPerM: 0, outPerM: 0 }).run({
      run, locale: 'es', system: 's', messages: [],
      tools: [{ name: 'get_platform_kpis', description: long, inputSchema: { type: 'object', properties: { from: { type: 'string', description: long, examples: ['a'] } } } }],
      limits: REPORT_GUARDRAILS(8, 1e6),
      mcp: new FakeMcp({ get_platform_kpis: { a: null, b: 1.23456, rows: Array.from({ length: 60 }, (_, i) => ({ i })) } }, new Set(), [{ name: 'get_platform_kpis', description: 'x', inputSchema: {} }]),
    });
    const offered = llm.requests[0]!.tools![0]!;
    expect(offered.description.length).toBeLessThanOrEqual(330);
    expect(JSON.stringify(offered.inputSchema)).not.toContain('examples');
    const content = (out.messages[1]!.content[0] as { content: string }).content;
    expect(content).not.toContain('"a"');
    expect(content).toContain('1.23');
    expect(content).toContain('…+20 more');
    expect((out.toolResults[0] as { rows: unknown[] }).rows).toHaveLength(60);
    expect(out.toolCalls).toEqual([{ name: 'get_platform_kpis', input: {} }]);
  });
});

describe('tool routing (Q&A offers only the tools of the question topic)', () => {
  const ALL = ['calculate', 'detect_anomalies', 'get_content_rankings', 'get_content_stats', 'get_credit_stats', 'get_event_ranking', 'get_platform_kpis', 'get_registration_stats', 'get_service_health', 'get_ticket_stats', 'get_top_credit_spenders', 'get_user_stats', 'get_wallet_overview', 'list_events', 'list_failed_sagas', 'list_flagged_content', 'list_recent_registrations'].map((name) => ({ name }));
  const names = (q: string) => routeTools(q, ALL).map((t) => t.name);
  it('narrows by topic and adds calculate only for derived figures', () => {
    expect(names('¿Cuántos usuarios están suspendidos?')).toEqual(['get_platform_kpis', 'get_user_stats']);
    expect(names('¿Hay mensajes en las colas de error?')).toEqual(['get_service_health']);
    expect(names('¿Cuál es el promedio de créditos por inscripción?')).toContain('calculate');
    expect(names('Compare this week registrations with last week')).toContain('calculate');
    expect(names('What is the platform health?')).toContain('get_service_health');
  });
  it('offers every tool when the topic is not recognized, and never routes to nothing', () => {
    expect(names('cuéntame algo interesante')).toHaveLength(ALL.length);
    expect(routeTools('¿Cuántos usuarios hay?', [{ name: 'calculate' }, { name: 'get_service_health' }]).map((t) => t.name)).toEqual(['calculate', 'get_service_health']);
  });
});
