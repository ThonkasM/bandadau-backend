import { checkNumberFidelity } from '../../../src/entities/policies/number-fidelity';
import { AnthropicAdapter } from '../../../src/interface-adapters/gateways/llm/anthropic.adapter';
import { OllamaAdapter } from '../../../src/interface-adapters/gateways/llm/ollama.adapter';
import { composeFromData, inferRange, planTools, StubLlmAdapter } from '../../../src/interface-adapters/gateways/llm/stub.adapter';
import { PiperTts, PollyTts, wavDurationSeconds } from '../../../src/interface-adapters/gateways/tts/tts.adapters';
import type { LlmRequest } from '../../../src/use-cases/ports/llm.port';
import { parseComposed } from '../../../src/use-cases/reports/report-schemas';
import { TOOL_DEFS } from '../../support/fakes';

const base: LlmRequest = { tier: 'smart', purpose: 'collect', locale: 'es', system: 'sys', messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }], maxTokens: 1000 };

describe('StubLlmAdapter (deterministic default for local/CI)', () => {
  it('infers date ranges from the question (es/en)', () => {
    expect(inferRange('inscripciones en septiembre comparado con agosto', '2026-10-15')).toEqual({ from: '2026-08-01', to: '2026-09-30' });
    expect(inferRange('how was last month', '2026-10-15')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(inferRange('actividad de la semana pasada', '2026-10-15')).toEqual({ from: '2026-10-08', to: '2026-10-14' });
    expect(inferRange('últimos 10 días', '2026-10-15')).toEqual({ from: '2026-10-06', to: '2026-10-15' });
    expect(inferRange('resumen general', '2026-10-15')).toEqual({ from: '2026-09-16', to: '2026-10-15' });
    expect(inferRange('y en diciembre?', '2026-10-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
  it('plans only offered tools matching the question', () => {
    const offered = new Set(TOOL_DEFS.map((t) => t.name));
    const range = { from: '2026-09-16', to: '2026-10-15' };
    expect(planTools('¿Cuántas inscripciones hubo?', range, offered).map((p) => p.name)).toEqual(['get_platform_kpis', 'get_registration_stats']);
    expect(planTools('¿Hay servicios caídos?', range, offered).map((p) => p.name)).toEqual(['get_platform_kpis', 'get_service_health']);
    expect(planTools('hola', range, offered).map((p) => p.name)).toContain('get_registration_stats');
  });

  it('collect -> tool_use, then end_turn once results are in the conversation', async () => {
    const llm = new StubLlmAdapter();
    const first = await llm.complete({ ...base, tools: TOOL_DEFS, meta: { question: 'inscripciones del último mes', today: '2026-10-15' } });
    expect(first.stopReason).toBe('tool_use');
    expect(first.content.filter((b) => b.type === 'tool_use').length).toBeGreaterThan(0);
    const second = await llm.complete({ ...base, tools: TOOL_DEFS, messages: [...base.messages, { role: 'user', content: [{ type: 'tool_result', toolUseId: 'x', content: '<tool_data source="a">{}</tool_data>' }] }] });
    expect(second.stopReason).toBe('end_turn');
  });

  const kpis = { from: '2026-09-16', to: '2026-10-15', activeUsers: 12, newUsers: 22, posts: 8, comments: 0, reactions: 0, registrationsConfirmed: 11, registrationsFailed: 4, registrationsCancelled: 0, creditsToppedUp: 500, creditsSpent: 160, flaggedContent: 5, openAlerts: 0, series: [] };
  const data = {
    get_platform_kpis: kpis,
    get_registration_stats: { from: '2026-09-16', to: '2026-10-15', groupBy: 'day', rows: [{ key: '2026-10-14', confirmed: 4, failed: 1, cancelled: 0, pending: 0 }, { key: '2026-10-15', confirmed: 7, failed: 3, cancelled: 0, pending: 0 }], totals: { confirmed: 11, failed: 4, cancelled: 0, pending: 0 } },
    get_credit_stats: { from: '2026-09-16', to: '2026-10-15', groupBy: 'day', totals: { topUpCount: 7, topUpCredits: 500, debitCount: 8, debitCredits: 160, refundCount: 3, refundCredits: 80, netCredits: 420 }, series: [] },
    get_content_stats: { from: '2026-09-16', to: '2026-10-15', totals: { posts: 8, comments: 0, reactions: 0 }, reactionsByType: { LIKE: 0, HELPFUL: 0, FUNNY: 0, SUPPORT: 0 }, daily: [], topHashtags: [{ hashtag: 'bandada', count: 3 }, { hashtag: 'umsa', count: 1 }] },
    list_failed_sagas: { count: 3, byFailureReason: { TICKET_ISSUE_FAILED: 3 }, items: [] },
    get_service_health: { overall: 'DOWN', services: [{ name: 'wallet-service', status: 'DOWN' }], queues: [{ name: 'x.dlq', messagesReady: 2, isDeadLetter: true }] },
    list_flagged_content: { totalPending: 5, oldestEnqueuedAt: '2026-10-14T10:00:00Z', items: [] },
    list_events: { items: [{ title: 'Taller de Git 2', seatsTaken: 3, capacity: 30 }] },
    detect_anomalies: { anomalies: [{ metric: 'posts', at: '2026-10-10', value: 90, expected: 10 }] },
  };

  it.each(['es', 'en'] as const)('composes a %s report whose every figure comes from the tool data (A2)', async (locale) => {
    const llm = new StubLlmAdapter();
    const results = Object.entries(data).map(([name, v], i) => ({ type: 'tool_result' as const, toolUseId: `t${i}`, content: `<tool_data source="${name}">${JSON.stringify(v)}</tool_data>` }));
    const res = await llm.complete({ ...base, locale, purpose: 'compose', messages: [{ role: 'user', content: results }] });
    const composed = parseComposed((res.content[0] as { text: string }).text);
    expect(checkNumberFidelity(composed.markdown, composed.dataset, Object.values(data))).toEqual({ ok: true, unsupported: [] });
    expect(composed.markdown).toContain(locale === 'es' ? '## Limitaciones' : '## Limitations');
    expect(composed.markdown).toContain(locale === 'es' ? '11 confirmadas' : '11 confirmed');
    expect(composed.dataset.rows.length).toBeGreaterThan(0);
    expect(composed.chartIntent.type).toMatch(/line|bar|table/);
    expect(composed.markdown).not.toMatch(/\*\*#/); // hashtags are rendered as plain data
  });

  it('with no data it says so instead of inventing figures', () => {
    const c = composeFromData('es', {});
    expect(c.markdown).toContain('No hay datos disponibles');
    expect(c.dataset.rows).toEqual([]);
  });

  it('writes the audio script from the markdown and explains alerts per kind', async () => {
    const llm = new StubLlmAdapter();
    const a = await llm.complete({ ...base, purpose: 'audio_script', messages: [{ role: 'user', content: [{ type: 'text', text: '## T\n\n- **Inscripciones**: 11 confirmadas.\n\n## Limitaciones\n\nTexto.' }] }] });
    expect((a.content[0] as { text: string }).text).toMatch(/Resumen en audio.*11 confirmadas/);
    expect((a.content[0] as { text: string }).text).not.toMatch(/[*#]/);
    const e = await llm.complete({ ...base, purpose: 'explain_alert', messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ kind: 'SERVICE_DOWN', resource: 'wallet-service' }) }] }] });
    expect((e.content[0] as { text: string }).text).toContain('wallet-service');
  });
});

describe('AnthropicAdapter', () => {
  it('is disabled without an API key', async () => {
    const a = new AnthropicAdapter({ apiKey: undefined, model: 'claude-sonnet-5-5', modelCheap: 'claude-haiku-5-5' });
    expect(a.enabled).toBe(false);
    await expect(a.complete(base)).rejects.toThrow(/disabled/);
  });
  it('maps tiers to models, caches the system prompt, sends tools and parses tool_use + usage', async () => {
    const calls: Record<string, any>[] = [];
    const client = {
      messages: {
        create: async (p: Record<string, any>) => {
          calls.push(p);
          return { model: p.model, stop_reason: 'tool_use', content: [{ type: 'text', text: 'voy' }, { type: 'tool_use', id: 'tu1', name: 'get_platform_kpis', input: { from: '2026-10-01' } }], usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 } };
        },
      },
    };
    const a = new AnthropicAdapter({ apiKey: 'k', model: 'claude-sonnet-5-5', modelCheap: 'claude-haiku-5-5', client: client as never });
    const res = await a.complete({ ...base, tools: TOOL_DEFS.slice(0, 1), effort: 'medium', messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }, { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'get_platform_kpis', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', toolUseId: 'x', content: 'data', isError: true }] }] });
    expect(calls[0]).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 1000, system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }], output_config: { effort: 'medium' } });
    expect(calls[0]!.tools[0]).toMatchObject({ name: 'get_platform_kpis', input_schema: { type: 'object' } });
    expect(calls[0]!.messages[2].content[0]).toEqual({ type: 'tool_result', tool_use_id: 'x', content: 'data', is_error: true });
    expect(res).toMatchObject({ stopReason: 'tool_use', usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 100, cacheWriteTokens: 20 } });
    expect(res.content[1]).toEqual({ type: 'tool_use', id: 'tu1', name: 'get_platform_kpis', input: { from: '2026-10-01' } });
    await a.complete({ ...base, tier: 'fast' });
    expect(calls[1]).toMatchObject({ model: 'claude-haiku-5-5' });
    expect(calls[1]!.tools).toBeUndefined();
  });
  it('sends structured-output format and flattens tool blocks when no tools are offered; provider failures become LLM_UNAVAILABLE', async () => {
    const calls: Record<string, any>[] = [];
    const ok = { messages: { create: async (p: Record<string, any>) => (calls.push(p), { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 1, output_tokens: 1 } }) } };
    const a = new AnthropicAdapter({ apiKey: 'k', model: 's', modelCheap: 'h', client: ok as never });
    await a.complete({ ...base, purpose: 'compose', responseSchema: { type: 'object' }, messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'n', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', toolUseId: 'x', content: 'R' }] }] });
    expect(calls[0]!.output_config.format).toEqual({ type: 'json_schema', schema: { type: 'object' } });
    expect(JSON.stringify(calls[0]!.messages)).not.toContain('tool_use_id');
    const bad = new AnthropicAdapter({ apiKey: 'k', model: 's', modelCheap: 'h', client: { messages: { create: async () => Promise.reject(Object.assign(new Error('overloaded'), { status: 529, name: 'APIError' })) } } as never });
    await expect(bad.complete(base)).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });
  });
});

describe('OllamaAdapter', () => {
  it('maps tool calls and usage, and sends the JSON schema as `format`', async () => {
    const bodies: Record<string, any>[] = [];
    const fetchImpl = (async (_u: unknown, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ model: 'llama3.2', message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'get_platform_kpis', arguments: { from: 'a' } } }] }, prompt_eval_count: 11, eval_count: 7, done_reason: 'stop' }), { status: 200 });
    }) as unknown as typeof fetch;
    const o = new OllamaAdapter({ url: 'http://ollama:11434', model: 'llama3.2', fetch: fetchImpl });
    const res = await o.complete({ ...base, tools: TOOL_DEFS.slice(0, 1), responseSchema: { type: 'object' } });
    expect(bodies[0]).toMatchObject({ model: 'llama3.2', stream: false, format: { type: 'object' }, tools: [{ type: 'function', function: { name: 'get_platform_kpis' } }] });
    expect(res).toMatchObject({ stopReason: 'tool_use', usage: { inputTokens: 11, outputTokens: 7 } });
    const bad = new OllamaAdapter({ url: 'http://x', model: 'm', fetch: (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch });
    await expect(bad.complete(base)).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });
  });
});

describe('TTS adapters', () => {
  const wav = (seconds: number, rate = 16000) => {
    const data = Buffer.alloc(seconds * rate * 2);
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
    h.write('data', 36); h.writeUInt32LE(data.length, 40);
    return Buffer.concat([h, data]);
  };
  it('computes WAV duration from the header', () => {
    expect(wavDurationSeconds(wav(3))).toBeCloseTo(3, 2);
    expect(wavDurationSeconds(Buffer.from('garbage'), 25)).toBeCloseTo(10, 1);
  });
  it('Piper: POSTs text + voice per locale and returns wav', async () => {
    const seen: Record<string, any>[] = [];
    const f = (async (_u: unknown, init: { body: string }) => (seen.push(JSON.parse(init.body)), new Response(wav(2), { status: 200 }))) as unknown as typeof fetch;
    const t = new PiperTts({ url: 'http://piper:5002', voiceEs: 'es_MX-x', voiceEn: 'en_US-y', fetch: f });
    const r = await t.synthesize('hola mundo', 'es');
    await t.synthesize('hello', 'en');
    expect(seen.map((s) => s.voice)).toEqual(['es_MX-x', 'en_US-y']);
    expect([r.mime, Math.round(r.durationSeconds)]).toEqual(['audio/wav', 2]);
    const down = new PiperTts({ url: 'http://x', voiceEs: 'a', voiceEn: 'b', fetch: (async () => new Response('', { status: 503 })) as unknown as typeof fetch });
    await expect(down.synthesize('x', 'es')).rejects.toThrow(/503/);
  });
  it('Polly: neural mp3 with es-MX / en-US voices; disabled flag respected', async () => {
    const sent: Record<string, any>[] = [];
    const client = { send: async (cmd: { input: Record<string, any> }) => (sent.push(cmd.input), { AudioStream: { transformToByteArray: async () => new Uint8Array(24_000) } }) };
    const p = new PollyTts({ region: 'us-east-1', voiceEs: 'Mia', voiceEn: 'Joanna', enabled: true, client: client as never });
    const r = await p.synthesize('uno dos tres', 'es');
    await p.synthesize('one two', 'en');
    expect(sent[0]).toMatchObject({ Engine: 'neural', OutputFormat: 'mp3', VoiceId: 'Mia', LanguageCode: 'es-MX' });
    expect(sent[1]).toMatchObject({ VoiceId: 'Joanna', LanguageCode: 'en-US' });
    expect(r.mime).toBe('audio/mpeg');
    expect(new PollyTts({ region: 'r', voiceEs: 'a', voiceEn: 'b', enabled: false, client: client as never }).enabled).toBe(false);
  });
});
