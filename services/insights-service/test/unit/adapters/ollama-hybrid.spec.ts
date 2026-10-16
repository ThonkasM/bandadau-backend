import { LlmUnavailableError } from '../../../src/entities/errors/domain-errors';
import { loadConfig } from '../../../src/frameworks-drivers/config/app-config';
import { AnthropicAdapter } from '../../../src/interface-adapters/gateways/llm/anthropic.adapter';
import { FallbackLlmAdapter } from '../../../src/interface-adapters/gateways/llm/fallback.adapter';
import { OllamaAdapter } from '../../../src/interface-adapters/gateways/llm/ollama.adapter';
import { isGroundedAnswer, OllamaHybridAdapter, validatePlan } from '../../../src/interface-adapters/gateways/llm/ollama-hybrid.adapter';
import { StubLlmAdapter } from '../../../src/interface-adapters/gateways/llm/stub.adapter';
import type { LlmRequest } from '../../../src/use-cases/ports/llm.port';
import { REPORT_AGENT_TOOLS } from '../../../src/use-cases/reports/generate-report';
import { parseComposed } from '../../../src/use-cases/reports/report-schemas';

const TOOLS = ['get_platform_kpis', 'get_registration_stats', 'get_credit_stats', 'get_content_stats', 'list_events', 'list_recent_registrations', 'get_top_credit_spenders', 'list_flagged_content'].map((name) => ({ name, description: `${name} tool`, inputSchema: { type: 'object' } }));
const TODAY = '2026-10-16';

/** A simulated Ollama server: `/api/chat` answers with whatever the test scripts, and records the requests. */
function ollamaServer(replies: (body: Record<string, any>) => { message?: Record<string, unknown>; status?: number } | 'timeout') {
  const requests: Record<string, any>[] = [];
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, any>;
    requests.push(body);
    const r = replies(body);
    if (r === 'timeout') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    return new Response(JSON.stringify({ model: 'qwen2.5:3b', message: r.message ?? { role: 'assistant', content: '' }, prompt_eval_count: 10, eval_count: 5, done_reason: 'stop' }), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { requests, ollama: new OllamaAdapter({ url: 'http://ollama:11434', model: 'qwen2.5:3b', fetch: fetchImpl, timeoutMs: 5000 }) };
}
const say = (obj: unknown) => ({ message: { role: 'assistant', content: JSON.stringify(obj) } });

const collect = (question: string): LlmRequest => ({ tier: 'smart', purpose: 'collect', locale: 'es', system: 'sys', messages: [{ role: 'user', content: [{ type: 'text', text: question }] }], tools: TOOLS, maxTokens: 1000, meta: { question, today: TODAY } });
const result = (name: string, v: unknown) => ({ type: 'tool_result' as const, toolUseId: name, content: `<tool_data source="${name}">${JSON.stringify(v)}</tool_data>` });
const compose = (question: string, locale: 'es' | 'en', ...results: ReturnType<typeof result>[]): LlmRequest => ({ tier: 'smart', purpose: 'compose', locale, system: 'sys', messages: [{ role: 'user', content: results }], maxTokens: 1000, meta: { question, today: TODAY } });

const buyers = { truncated: false, items: [{ registrationId: 'r1', ticketId: null, event: { id: 'e', title: 'Taller de React Native' }, buyer: { userId: 'u1', displayName: 'Diego Flores' }, creditsPaid: 25, status: 'CONFIRMED', confirmedAt: '2026-10-16T14:32:00Z' }] };

describe('OllamaHybridAdapter (small local model: code decides facts)', () => {
  it('recognized questions never ask the model to plan: deterministic tools and dates', async () => {
    const { ollama, requests } = ollamaServer(() => ({ message: { role: 'assistant', content: 'should not be used' } }));
    const llm = new OllamaHybridAdapter({ ollama, fallback: 'stub', model: 'qwen2.5:3b' });
    const res = await llm.complete(collect('¿Quién gastó más créditos esta semana?'));
    expect(requests).toHaveLength(0);
    expect(res.stopReason).toBe('tool_use');
    expect(res.content[0]).toMatchObject({ type: 'tool_use', name: 'get_top_credit_spenders', input: { from: '2026-10-12', to: TODAY, limit: 5 } });
  });

  it('open questions ask Ollama for a JSON-schema plan and VALIDATE it', async () => {
    const { ollama, requests } = ollamaServer(() => say({ tools: ['get_content_stats', 'list_flagged_content'], from: '2026-10-01', to: '2026-10-15' }));
    const llm = new OllamaHybridAdapter({ ollama, fallback: 'stub', model: 'qwen2.5:3b' });
    const res = await llm.complete(collect('cómo va la comunidad'));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.format.properties.tools.items.enum).toEqual(expect.arrayContaining(['get_content_stats']));
    expect(requests[0]!.tools).toBeUndefined();
    expect(requests[0]!.options.temperature).toBe(0);
    expect(res.content.map((b) => (b.type === 'tool_use' ? [b.name, b.input] : null))).toEqual([
      ['get_content_stats', { from: '2026-10-01', to: '2026-10-15', topHashtags: 5 }],
      ['list_flagged_content', { source: 'ALL', limit: 10 }],
    ]);
  });

  it.each([
    ['invented date field', { tools: ['get_content_stats'], from: 'this_week_start', to: TODAY }],
    ['inverted range', { tools: ['get_content_stats'], from: '2026-10-16', to: '2026-10-01' }],
    ['impossible date', { tools: ['get_content_stats'], from: '2026-02-31', to: TODAY }],
    ['unknown tool', { tools: ['drop_database'], from: '2026-10-01', to: TODAY }],
    ['forbidden write tool', { tools: ['raise_alert'], from: '2026-10-01', to: TODAY }],
    ['no tools', { tools: [], from: '2026-10-01', to: TODAY }],
    ['range over a year', { tools: ['get_content_stats'], from: '2024-01-01', to: TODAY }],
  ])('an invalid model plan (%s) falls back to the generic deterministic plan', async (_n, plan) => {
    const { ollama } = ollamaServer(() => say(plan));
    const res = await new OllamaHybridAdapter({ ollama, fallback: 'stub', model: 'm' }).complete(collect('cómo va la comunidad'));
    const names = res.content.flatMap((b) => (b.type === 'tool_use' ? [b.name] : []));
    expect(names).toEqual(expect.arrayContaining(['get_platform_kpis', 'get_registration_stats']));
    expect(names).not.toContain('drop_database');
  });

  it('validatePlan accepts a well-formed plan only', () => {
    const offered = new Set(['get_content_stats']);
    expect(validatePlan({ tools: ['get_content_stats'], from: '2026-10-01', to: '2026-10-02' }, offered)).toEqual({ tools: ['get_content_stats'], from: '2026-10-01', to: '2026-10-02' });
    expect(validatePlan('x', offered)).toBeNull();
    expect(validatePlan({ tools: ['get_content_stats'], from: '2026-10-01' }, offered)).toBeNull();
  });

  it('Ollama down while planning: fallback=stub keeps working, fallback=none fails', async () => {
    const down = () => ollamaServer(() => 'timeout').ollama;
    const ok = await new OllamaHybridAdapter({ ollama: down(), fallback: 'stub', model: 'm' }).complete(collect('cómo va la comunidad'));
    expect(ok.stopReason).toBe('tool_use');
    await expect(new OllamaHybridAdapter({ ollama: down(), fallback: 'none', model: 'm' }).complete(collect('cómo va la comunidad'))).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it('uses the model wording when its figures and names are grounded in the tool data', async () => {
    const { ollama, requests } = ollamaServer(() => say({ answer: 'El último ticket lo compró Diego Flores, quien pagó 25 créditos por Taller de React Native.' }));
    const llm = new OllamaHybridAdapter({ ollama, fallback: 'stub', model: 'qwen2.5:3b' });
    const res = await llm.complete(compose('¿Quién compró el último ticket?', 'es', result('list_recent_registrations', buyers)));
    const composed = parseComposed((res.content[0] as { text: string }).text);
    expect(composed.markdown.split('\n')[0]).toBe('El último ticket lo compró Diego Flores, quien pagó 25 créditos por Taller de React Native.');
    expect(composed.markdown).toContain('## Detalle');
    expect(res.model).toBe('qwen2.5:3b');
    expect(requests[0]!.messages[1].content).toContain('Diego Flores'); // facts travel to the model, the request is in the AgentRun audit via model/provider
  });

  it.each([
    ['invented figure', 'El último ticket lo compró Diego Flores y pagó 99 créditos.'],
    ['invented name', 'El último ticket lo compró Carlos Mamani por 25 créditos.'],
    ['multi-line markdown', 'Diego Flores compró.\n\n## Otra cosa'],
    ['empty answer', ''],
  ])('discards an ungrounded answer (%s) and keeps the deterministic one', async (_n, answer) => {
    const { ollama } = ollamaServer(() => say({ answer }));
    const res = await new OllamaHybridAdapter({ ollama, fallback: 'stub', model: 'qwen2.5:3b' }).complete(compose('¿Quién compró el último ticket?', 'es', result('list_recent_registrations', buyers)));
    const composed = parseComposed((res.content[0] as { text: string }).text);
    expect(composed.markdown.split('\n')[0]).toBe('El último ticket lo compró Diego Flores (Taller de React Native, 25 créditos) el 16/10/2026 a las 14:32 (UTC).');
    expect(res.model).toBe('qwen2.5:3b+stub-fallback');
  });

  it('timeout while writing: deterministic answer with fallback=stub (provider recorded), error with none', async () => {
    const llm = (fallback: 'stub' | 'none') => new OllamaHybridAdapter({ ollama: ollamaServer(() => 'timeout').ollama, fallback, model: 'qwen2.5:3b' });
    const req = compose('How many new users today?', 'en', result('get_platform_kpis', { from: TODAY, to: TODAY, activeUsers: 5, newUsers: 3, posts: 0, comments: 0, reactions: 0, registrationsConfirmed: 0, registrationsFailed: 0, registrationsCancelled: 0, creditsToppedUp: 0, creditsSpent: 0, flaggedContent: 0, openAlerts: 0, series: [] }));
    const res = await llm('stub').complete(req);
    expect(parseComposed((res.content[0] as { text: string }).text).markdown.split('\n')[0]).toBe('Today, 3 new users signed up.');
    expect(res.model).toBe('qwen2.5:3b+stub-fallback');
    await expect(llm('none').complete(req)).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it('isGroundedAnswer checks numbers and capitalized names against the data', () => {
    const data = { list_recent_registrations: buyers };
    expect(isGroundedAnswer('Diego Flores compró 1 entrada de 25 créditos.', data)).toBe(false); // 1 is not in the data
    expect(isGroundedAnswer('Diego Flores compró una entrada de 25 créditos.', data)).toBe(true);
    expect(isGroundedAnswer('Escribe a diego@x.com para 25 créditos pagados.', data)).toBe(false);
  });
});

describe('tool definitions reach the providers', () => {
  it('the report agent offers the buyer tools and the Anthropic adapter sends them as tools', async () => {
    expect(REPORT_AGENT_TOOLS).toEqual(expect.arrayContaining(['list_recent_registrations', 'get_top_credit_spenders']));
    const seen: Record<string, any>[] = [];
    const client = { messages: { create: async (p: Record<string, any>) => (seen.push(p), { model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }) } };
    await new AnthropicAdapter({ apiKey: 'k', model: 'claude-haiku-5-5', modelCheap: 'claude-haiku-5-5', client: client as never }).complete(collect('quién compró el último ticket'));
    expect(seen[0]!.tools.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(['list_recent_registrations', 'get_top_credit_spenders']));
    expect(seen[0]!.model).toBe('claude-haiku-5-5');
  });
});

describe('FallbackLlmAdapter and config defaults', () => {
  it('falls back to the stub only on LlmUnavailableError', async () => {
    const req = collect('hola');
    const down = { provider: 'claude', complete: async () => { throw new LlmUnavailableError('503'); } };
    const res = await new FallbackLlmAdapter(down, new StubLlmAdapter()).complete(req);
    expect(res.model).toBe('stub-deterministic-1(fallback)');
    const broken = { provider: 'claude', complete: async () => { throw new Error('bug'); } };
    await expect(new FallbackLlmAdapter(broken, new StubLlmAdapter()).complete(req)).rejects.toThrow('bug');
  });
  it('defaults: Claude model claude-haiku-5-5 (ANTHROPIC_MODEL overrides), Ollama qwen2.5:3b with a 120 s timeout', () => {
    const base = { NODE_ENV: 'test', RABBITMQ_URL: 'amqp://x', JWKS_URL: 'http://x', JWT_ISSUER: 'x', IDENTITY_URL: 'http://x', SERVICE_CLIENT_SECRET: 'x' } as NodeJS.ProcessEnv;
    const c = loadConfig({ ...base });
    expect([c.llmModel, c.llmModelCheap, c.ollamaModel, c.ollamaTimeoutMs, c.llmFallback]).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5', 'qwen2.5:3b', 120_000, 'none']);
    const o = loadConfig({ ...base, ANTHROPIC_MODEL: 'claude-sonnet-5-5', OLLAMA_TIMEOUT_MS: '30000', LLM_FALLBACK: 'stub' });
    expect([o.llmModel, o.ollamaTimeoutMs, o.llmFallback]).toEqual(['claude-sonnet-5-5', 30_000, 'stub']);
  });
});
