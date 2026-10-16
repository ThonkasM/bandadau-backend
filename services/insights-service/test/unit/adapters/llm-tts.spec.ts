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

describe('StubLlmAdapter: concrete admin questions (es/en)', () => {
  const TODAY = '2026-10-16'; // a Friday
  const offered = new Set([...TOOL_DEFS.map((t) => t.name), 'list_recent_registrations', 'get_top_credit_spenders', 'get_credit_stats', 'list_events', 'get_content_stats', 'get_platform_kpis']);
  const plan = (q: string) => planTools(q, inferRange(q, TODAY), offered, TODAY);
  const names = (q: string) => plan(q).map((p) => p.name);

  it.each([
    ['¿Quién compró el último ticket?', ['list_recent_registrations']],
    ['¿Quién fue el último comprador?', ['list_recent_registrations']],
    ['quien compro la ultima entrada', ['list_recent_registrations']],
    ['¿Quién se inscribió hoy?', ['list_recent_registrations']],
    ['Who bought the last ticket?', ['list_recent_registrations']],
    ['who bought tickets yesterday', ['list_recent_registrations']],
    ['Show me the latest registration', ['list_recent_registrations']],
    ['¿Quién gastó más créditos esta semana?', ['get_top_credit_spenders']],
    ['usuario que más créditos gastó este mes', ['get_top_credit_spenders']],
    ['top 5 gastadores', ['get_top_credit_spenders']],
    ['ranking de usuarios por gasto', ['get_top_credit_spenders']],
    ['Who spent the most credits this week?', ['get_top_credit_spenders']],
    ['top spenders last month', ['get_top_credit_spenders']],
    ['¿Qué evento tiene más inscritos?', ['list_events']],
    ['evento más popular', ['list_events']],
    ['Which event has the most registrations?', ['list_events']],
    ['top events', ['list_events']],
    ['¿Cuántos usuarios nuevos hoy?', ['get_platform_kpis']],
    ['How many new users today?', ['get_platform_kpis']],
  ])('plans the right tool for %j', (q, expected) => {
    expect(names(q)).toEqual(expected);
  });

  it('keeps the aggregate tools for count questions', () => {
    expect(names('¿Cuántos créditos se gastaron hoy?')).toEqual(['get_platform_kpis', 'get_credit_stats']);
    expect(names('How many credits were spent today?')).toEqual(['get_platform_kpis', 'get_credit_stats']);
  });

  it('understands "hoy / ayer / esta semana / último" ranges', () => {
    expect(inferRange('¿Cuántos créditos hoy?', TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(inferRange('credits yesterday', TODAY)).toEqual({ from: '2026-10-15', to: '2026-10-15' });
    expect(inferRange('quién gastó más esta semana', TODAY)).toEqual({ from: '2026-10-12', to: TODAY }); // Monday of the week
    expect(inferRange('who spent most this week', TODAY)).toEqual({ from: '2026-10-12', to: TODAY });
    expect(inferRange('gasto de este mes', TODAY)).toEqual({ from: '2026-10-01', to: TODAY });
    expect(inferRange('la última semana', TODAY)).toEqual({ from: '2026-10-10', to: TODAY });
    expect(inferRange('the past month', TODAY)).toEqual({ from: '2026-09-17', to: TODAY });
    expect(inferRange('últimas 24 horas', TODAY)).toEqual({ from: '2026-10-15', to: TODAY });
  });

  it('asks the recent-registrations tool with a range only when the question names one', () => {
    expect(plan('¿Quién compró el último ticket?')[0]?.input).toEqual({ status: 'CONFIRMED', limit: 5 });
    expect(plan('¿Quién se inscribió hoy?')[0]?.input).toMatchObject({ status: 'CONFIRMED', from: TODAY, to: TODAY });
  });

  const result = (name: string, v: unknown) => ({ type: 'tool_result' as const, toolUseId: name, content: `<tool_data source="${name}">${JSON.stringify(v)}</tool_data>` });
  const answer = async (locale: 'es' | 'en', question: string, ...results: ReturnType<typeof result>[]) => {
    const res = await new StubLlmAdapter().complete({ ...base, locale, purpose: 'compose', messages: [{ role: 'user', content: results }], meta: { question, today: TODAY } });
    const composed = parseComposed((res.content[0] as { text: string }).text);
    return { composed, first: composed.markdown.split('\n')[0] as string };
  };
  const buyers = { truncated: false, items: [{ registrationId: 'r1', ticketId: null, event: { id: 'e', title: 'Taller de React Native' }, buyer: { userId: 'u1', displayName: 'Diego Flores' }, creditsPaid: 25, status: 'CONFIRMED', confirmedAt: '2026-10-16T14:32:00Z' }, { registrationId: 'r2', ticketId: null, event: { id: 'e', title: 'Taller de Git' }, buyer: { userId: 'u2', displayName: null }, creditsPaid: 20, status: 'CONFIRMED', confirmedAt: '2026-10-16T10:00:00Z' }] };

  it('answers "who bought the last ticket" in the FIRST line of the markdown, es and en', async () => {
    const es = await answer('es', '¿Quién compró el último ticket?', result('list_recent_registrations', buyers));
    expect(es.first).toBe('El último ticket lo compró Diego Flores (Taller de React Native, 25 créditos) el 16/10/2026 a las 14:32 (UTC).');
    const en = await answer('en', 'Who bought the last ticket?', result('list_recent_registrations', buyers));
    expect(en.first).toBe('The last ticket was bought by Diego Flores (Taller de React Native, 25 credits) on 16/10/2026 at 14:32 (UTC).');
    expect(es.composed.dataset.rows[0]).toEqual(['Diego Flores', 'Taller de React Native', 25, '2026-10-16T14:32:00Z']);
    expect(es.composed.markdown).toContain('nunca se incluyen correos ni teléfonos');
    expect(checkNumberFidelity(es.composed.markdown, es.composed.dataset, [buyers])).toEqual({ ok: true, unsupported: [] });
  });

  it('says so when there are no confirmed registrations or the buyer has no display name', async () => {
    const none = await answer('es', '¿Quién compró el último ticket?', result('list_recent_registrations', { truncated: false, items: [] }));
    expect(none.first).toBe('No encontré inscripciones confirmadas en el periodo consultado.');
    const unnamed = await answer('es', 'quién compró el último ticket', result('list_recent_registrations', { truncated: false, items: [buyers.items[1]] }));
    expect(unnamed.first).toContain('un usuario sin nombre registrado');
  });

  it('answers the credits question directly: "Hoy se gastaron 815 créditos en inscripciones."', async () => {
    const credits = { from: TODAY, to: TODAY, groupBy: 'day', totals: { topUpCount: 3, topUpCredits: 500, debitCount: 30, debitCredits: 815, refundCount: 0, refundCredits: 0, netCredits: -315 }, series: [{ date: TODAY, topUpCredits: 500, debitCredits: 815, refundCredits: 0 }] };
    const es = await answer('es', '¿Cuántos créditos se gastaron hoy?', result('get_credit_stats', credits));
    expect(es.first).toBe('Hoy se gastaron 815 créditos en inscripciones.');
    const en = await answer('en', 'How many credits were spent today?', result('get_credit_stats', credits));
    expect(en.first).toBe('Today, 815 credits were spent on registrations.');
    expect(checkNumberFidelity(es.composed.markdown, es.composed.dataset, [credits]).ok).toBe(true);
  });

  it('answers the top spender, top event and new users directly', async () => {
    const top = { from: '2026-10-12', to: TODAY, items: [{ userId: 'u1', displayName: 'Diego Flores', creditsSpent: 45, registrations: 2 }, { userId: 'u2', displayName: 'Ana', creditsSpent: 20, registrations: 1 }] };
    expect((await answer('es', '¿Quién gastó más créditos esta semana?', result('get_top_credit_spenders', top))).first).toBe('Quien más créditos gastó esta semana fue Diego Flores, con 45 créditos en 2 inscripciones.');
    expect((await answer('en', 'Who spent the most credits this week?', result('get_top_credit_spenders', top))).first).toBe('The top credit spender this week was Diego Flores, with 45 credits across 2 registrations.');
    const events = { truncated: false, items: [{ title: 'Taller de Git', seatsTaken: 12, capacity: 30 }, { title: 'Taller de Docker', seatsTaken: 40, capacity: 80 }] };
    expect((await answer('es', '¿Qué evento tiene más inscritos?', result('list_events', events))).first).toBe('El evento con más inscritos es Taller de Docker, con 40 inscritos de 80 cupos.');
    expect((await answer('en', 'Which event has the most registrations?', result('list_events', events))).first).toBe('The event with the most registrations is Taller de Docker, with 40 registered out of 80 seats.');
    const tie = { truncated: false, items: [{ title: 'Taller de Git', seatsTaken: 1, capacity: 30 }, { title: 'Hackathon', seatsTaken: 1, capacity: 120 }, { title: 'Charla', seatsTaken: 0, capacity: 80 }] };
    expect((await answer('es', '¿Qué evento tiene más inscritos?', result('list_events', tie))).first).toBe('Hay un empate: 2 eventos tienen el máximo de inscritos (1 inscrito), por ejemplo Taller de Git, Hackathon.');
    const kpis = { from: TODAY, to: TODAY, activeUsers: 5, newUsers: 3, posts: 0, comments: 0, reactions: 0, registrationsConfirmed: 0, registrationsFailed: 0, registrationsCancelled: 0, creditsToppedUp: 0, creditsSpent: 0, flaggedContent: 0, openAlerts: 0, series: [] };
    expect((await answer('es', '¿Cuántos usuarios nuevos hoy?', result('get_platform_kpis', kpis))).first).toBe('Hoy se registraron 3 usuarios nuevos.');
    expect((await answer('en', 'How many new users today?', result('get_platform_kpis', kpis))).first).toBe('Today, 3 new users signed up.');
  });

  it('keeps the generic summary for open questions', async () => {
    const r = await answer('es', 'resumen general', result('get_platform_kpis', { from: '2026-09-17', to: TODAY, activeUsers: 1, newUsers: 2, posts: 3, comments: 0, reactions: 0, registrationsConfirmed: 0, registrationsFailed: 0, registrationsCancelled: 0, creditsToppedUp: 0, creditsSpent: 0, flaggedContent: 0, openAlerts: 0, series: [] }));
    expect(r.first.startsWith('## Resumen de la plataforma')).toBe(true);
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
