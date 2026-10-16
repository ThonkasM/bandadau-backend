 
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { LlmUnavailableError } from '../../../src/entities/errors/domain-errors';
import { Pseudonymizer } from '../../../src/entities/policies/pseudonymizer';
import { type EngineEntry, LlmEngineRegistry } from '../../../src/interface-adapters/gateways/llm/engine-registry';
import { LlmAuthError, LlmInvalidOutputError, LlmNotFoundError, LlmRateLimitedError } from '../../../src/interface-adapters/gateways/llm/llm-errors';
import { modelRejection } from '../../../src/interface-adapters/gateways/llm/model-policy';
import { OpenAiCompatibleAdapter } from '../../../src/interface-adapters/gateways/llm/openai-compatible.adapter';
import { PseudonymizingLlmAdapter } from '../../../src/interface-adapters/gateways/llm/pseudonymizing.adapter';
import type { LlmPort, LlmRequest, LlmResponse } from '../../../src/use-cases/ports/llm.port';

interface Seen {
  path: string;
  headers: IncomingMessage['headers'];
  raw: string;
  body: any;
}
type Reply = { status?: number; headers?: Record<string, string>; json?: unknown; text?: string };

/** A simulated OpenCode Go: records every request and answers what the test scripts for that path. */
async function mockServer(handler: (seen: Seen) => Reply): Promise<{ url: string; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: any = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }
      const s: Seen = { path: req.url ?? '', headers: req.headers, raw, body };
      seen.push(s);
      const r = handler(s);
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json', ...(r.headers ?? {}) });
      res.end(r.text ?? JSON.stringify(r.json ?? {}));
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

const completion = (message: Record<string, unknown>, finish = 'stop') => ({ json: { model: 'glm-test', choices: [{ message, finish_reason: finish }], usage: { prompt_tokens: 11, completion_tokens: 7 } } });
const TOOLS = [{ name: 'list_recent_registrations', description: 'recent', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 5 } }, additionalProperties: false } }];
const req = (over: Partial<LlmRequest> = {}): LlmRequest => ({ tier: 'smart', purpose: 'collect', locale: 'es', system: 'sys', messages: [{ role: 'user', content: [{ type: 'text', text: '¿Quién compró el último ticket?' }] }], tools: TOOLS, maxTokens: 800, sessionId: 'run-1', ...over });

const adapter = (url: string, over: Partial<ConstructorParameters<typeof OpenAiCompatibleAdapter>[0]> = {}) =>
  new OpenAiCompatibleAdapter({ apiKey: 'test-key', baseUrl: url, chatPath: '/openai/v1/chat/completions', altChatPaths: ['/v1/chat/completions'], model: 'glm-test', userAgent: 'bandada-insights/test', sleep: async () => undefined, ...over });

describe('OpenAiCompatibleAdapter against a simulated OpenCode Go', () => {
  let srv: Awaited<ReturnType<typeof mockServer>>;
  afterEach(async () => srv?.close());

  it('native tool calling: sends tools, identifies itself and parses tool_calls', async () => {
    srv = await mockServer(() => completion({ content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_recent_registrations', arguments: '{"limit":1}' } }] }, 'tool_calls'));
    const res = await adapter(srv.url).complete(req());
    expect(res.stopReason).toBe('tool_use');
    expect(res.content).toEqual([{ type: 'tool_use', id: 'c1', name: 'list_recent_registrations', input: { limit: 1 } }]);
    expect(res.usage).toMatchObject({ inputTokens: 11, outputTokens: 7 });
    const s = srv.seen[0] as Seen;
    expect(s.path).toBe('/openai/v1/chat/completions');
    expect(s.headers.authorization).toBe('Bearer test-key');
    expect(s.headers['user-agent']).toBe('bandada-insights/test');
    expect(s.headers['x-opencode-session']).toMatch(/^bandada-[0-9a-f]{8}-run-1$/);
    expect(s.body.tools[0].function.name).toBe('list_recent_registrations');
    expect(s.body.max_tokens).toBeGreaterThanOrEqual(1024); // reasoning models need room
  });

  it('replays tool results as role=tool messages and returns the final text', async () => {
    srv = await mockServer(() => completion({ content: 'Hecho.' }));
    const messages: LlmRequest['messages'] = [
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'list_recent_registrations', input: { limit: 1 } }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'c1', content: '{"x":1}' }] },
    ];
    const res = await adapter(srv.url).complete(req({ messages }));
    expect(res.stopReason).toBe('end_turn');
    const sent = (srv.seen[0] as Seen).body.messages;
    expect(sent.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(sent[3]).toMatchObject({ tool_call_id: 'c1', content: '{"x":1}' });
  });

  it('an empty assistant turn without tool calls is replayed as an empty string (null is rejected by the provider)', async () => {
    srv = await mockServer(() => completion({ content: 'ok' }));
    const messages: LlmRequest['messages'] = [
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      { role: 'assistant', content: [{ type: 'text', text: '' }] },
      { role: 'user', content: [{ type: 'text', text: 'again' }] },
    ];
    await adapter(srv.url).complete(req({ messages, tools: undefined }));
    expect((srv.seen[0] as Seen).body.messages[2].content).toBe('');
  });

  it('401 -> LlmAuthError, 429 -> LlmRateLimitedError with Retry-After, both are LlmUnavailableError', async () => {
    srv = await mockServer(() => ({ status: 401, json: { error: 'bad key' } }));
    await expect(adapter(srv.url).complete(req())).rejects.toBeInstanceOf(LlmAuthError);
    await srv.close();
    srv = await mockServer(() => ({ status: 429, headers: { 'retry-after': '7' }, json: { error: 'limit' } }));
    const err = await adapter(srv.url).complete(req()).catch((e) => e);
    expect(err).toBeInstanceOf(LlmRateLimitedError);
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect((err as LlmRateLimitedError).retryAfterSeconds).toBe(7);
    expect(srv.seen).toHaveLength(1); // 429 is never retried
  });

  it('404 on the primary route tries the alternative one and remembers it', async () => {
    srv = await mockServer((s) => (s.path.startsWith('/openai') ? { status: 404, json: {} } : completion({ content: 'ok' })));
    const a = adapter(srv.url);
    await a.complete(req({ tools: undefined }));
    expect(srv.seen.map((s) => s.path)).toEqual(['/openai/v1/chat/completions', '/v1/chat/completions']);
    await a.complete(req({ tools: undefined }));
    expect(srv.seen[2]?.path).toBe('/v1/chat/completions');
    await srv.close();
    srv = await mockServer(() => ({ status: 404, json: {} }));
    await expect(adapter(srv.url).complete(req())).rejects.toBeInstanceOf(LlmNotFoundError);
  });

  it('5xx is retried a bounded number of times', async () => {
    let n = 0;
    srv = await mockServer(() => (++n < 2 ? { status: 503, json: {} } : completion({ content: 'ok' })));
    expect((await adapter(srv.url).complete(req({ tools: undefined }))).content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(n).toBe(2);
    await srv.close();
    srv = await mockServer(() => ({ status: 500, json: {} }));
    await expect(adapter(srv.url, { maxRetries: 2 }).complete(req())).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(srv.seen).toHaveLength(3);
  });

  it('invalid JSON, unknown tools and arguments that break the tool schema are rejected (one repair attempt)', async () => {
    srv = await mockServer(() => ({ text: 'not json at all' }));
    await expect(adapter(srv.url).complete(req())).rejects.toBeInstanceOf(LlmInvalidOutputError);
    await srv.close();
    let calls = 0;
    srv = await mockServer(() => (++calls === 1 ? completion({ content: '', tool_calls: [{ id: 'c', type: 'function', function: { name: 'list_recent_registrations', arguments: '{"limit":99}' } }] }, 'tool_calls') : completion({ content: '', tool_calls: [{ id: 'c', type: 'function', function: { name: 'list_recent_registrations', arguments: '{"limit":2}' } }] }, 'tool_calls')));
    const fixed = await adapter(srv.url).complete(req());
    expect(fixed.content[0]).toMatchObject({ input: { limit: 2 } });
    expect(srv.seen[1]?.body.messages.at(-1).content).toMatch(/invalid/);
    await srv.close();
    srv = await mockServer(() => completion({ content: '', tool_calls: [{ id: 'c', type: 'function', function: { name: 'drop_database', arguments: '{}' } }] }, 'tool_calls'));
    await expect(adapter(srv.url).complete(req())).rejects.toBeInstanceOf(LlmInvalidOutputError);
  });

  it('structured output: json_object mode, retried without response_format on 400, fences stripped', async () => {
    let n = 0;
    srv = await mockServer((s) => (s.body.response_format && ++n ? { status: 400, json: { error: 'unsupported' } } : completion({ content: '```json\n{"a":1}\n```' })));
    const res = await adapter(srv.url).complete(req({ tools: undefined, responseSchema: { type: 'object' } }));
    expect(res.content).toEqual([{ type: 'text', text: '{"a":1}' }]);
    expect(srv.seen[1]?.body.response_format).toBeUndefined();
    expect(srv.seen[1]?.body.messages[0].content).toContain('JSON Schema');
  });

  it('no key => disabled and auth error; contributor models are never allowed', async () => {
    const a = adapter('http://127.0.0.1:1', { apiKey: undefined });
    expect(a.enabled).toBe(false);
    await expect(a.complete(req())).rejects.toBeInstanceOf(LlmAuthError);
    expect(modelRejection('gemini-3-contributor', [])).toMatch(/training/);
    expect(modelRejection('muse-spark-2-contributor', ['*'])).toMatch(/training/);
    expect(modelRejection('glm-5.3-flash', ['glm-*', 'kimi-*'])).toBeNull();
    expect(modelRejection('gpt-9', ['glm-*'])).toMatch(/not in OPENCODE_ALLOWED_MODELS/);
    expect(adapter('http://x', { model: 'gemini-3-contributor' }).enabled).toBe(false);
  });
});

describe('privacy towards external providers (pseudonymization)', () => {
  let srv: Awaited<ReturnType<typeof mockServer>>;
  afterEach(async () => srv?.close());

  const results = (items: unknown) => [{ role: 'user' as const, content: [{ type: 'tool_result' as const, toolUseId: 'c1', content: `<tool_data source="x">${JSON.stringify(items)}</tool_data>` }] }];

  it('no displayName, email or phone reaches the external server, and the final answer gets the real names back', async () => {
    const data = { items: [{ buyer: { userId: 'u1', displayName: 'Diego Flores', email: 'diego@umsa.edu.bo' }, creditsPaid: 25, phone: '+591 70012345' }, { buyer: { userId: 'u2', displayName: 'María José Quispe' }, creditsPaid: 10 }] };
    srv = await mockServer(() => completion({ content: JSON.stringify({ markdown: 'Persona A pagó 25 créditos y Persona B pagó 10.', rows: [['Persona A'], ['Persona B']] }) }));
    const pseudo = new Pseudonymizer('es');
    const llm = new PseudonymizingLlmAdapter(adapter(srv.url), pseudo);
    const messages = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Pregunta: ¿quién compró? (Diego Flores)' }] }, ...results(data)];
    const res = await llm.complete(req({ tools: undefined, purpose: 'compose', messages, system: 'Eres un analista. Contacto: diego@umsa.edu.bo' }));

    const sent = (srv.seen[0] as Seen).raw;
    for (const secret of ['Diego', 'Flores', 'María', 'Quispe', 'diego@umsa.edu.bo', '70012345']) expect(sent).not.toContain(secret);
    expect(sent).toContain('Persona A');
    expect(sent).toContain('25'); // aggregated figures do go out
    const text = (res.content[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({ markdown: 'Diego Flores pagó 25 créditos y María José Quispe pagó 10.', rows: [['Diego Flores'], ['María José Quispe']] });
    // the caller's messages were not mutated
    expect(JSON.stringify(messages)).toContain('Diego Flores');
  });

  it('restores names in tool_use arguments and in plain text; unknown placeholders stay as they are', () => {
    const p = new Pseudonymizer('en');
    p.learn('{"displayName":"Ana Pérez"}');
    expect(p.sanitize('ana pérez bought it')).toBe('Person A bought it');
    expect(p.restore('Person A and Person Z')).toBe('Ana Pérez and Person Z');
    expect(p.restoreValue({ q: ['Person A'] })).toEqual({ q: ['Ana Pérez'] });
  });
});

describe('LlmEngineRegistry (Strategy + fallback chain + circuit breaker)', () => {
  const ok = (model: string, calls: string[]): LlmPort => ({ provider: model, complete: async () => (calls.push(model), ({ stopReason: 'end_turn', content: [{ type: 'text', text: 'x' }], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, model }) as LlmResponse) });
  const failing = (model: string, calls: string[], error: Error = new LlmUnavailableError('boom')): LlmPort => ({ provider: model, complete: async () => (calls.push(model), Promise.reject(error)) });
  const entry = (id: EngineEntry['id'], engine: EngineEntry['engine'], adapter: LlmPort, model: string | null, healthy = () => true, external = false): EngineEntry => ({ id, engine, label: id, model, mode: engine === 'STUB' ? 'DETERMINISTIC' : engine === 'OLLAMA' ? 'HYBRID' : 'AGENT', external, adapter, probe: async () => healthy() });
  const build = (calls: string[], opencode: LlmPort, o: { healthy?: { opencode?: () => boolean; ollama?: () => boolean }; order?: EngineEntry['id'][]; stubLast?: boolean; now?: () => number } = {}) =>
    new LlmEngineRegistry(
      [entry('opencode', 'OPENCODE', opencode, 'glm-test', o.healthy?.opencode, true), entry('ollama', 'OLLAMA', ok('qwen', calls), 'qwen', o.healthy?.ollama), entry('stub', 'STUB', ok('stub-deterministic-1', calls), null)],
      { order: o.order ?? ['opencode', 'ollama', 'stub'], stubLastResort: o.stubLast ?? true, now: o.now },
    );

  it('lists the three engines with availability, never keys: OPENCODE unavailable without key', async () => {
    const reg = build([], ok('glm-test', []), { healthy: { opencode: () => false } });
    const list = await reg.list();
    expect(list.map((e) => [e.engine, e.available, e.external, e.mode])).toEqual([['OPENCODE', false, true, 'AGENT'], ['OLLAMA', true, false, 'HYBRID'], ['STUB', true, false, 'DETERMINISTIC']]);
    expect(JSON.stringify(list)).not.toMatch(/key|http/i);
  });

  it('AUTO uses the first available engine in order and skips unavailable ones', async () => {
    const calls: string[] = [];
    const reg = build(calls, ok('glm-test', calls));
    expect((await reg.select('AUTO').complete(req())).engine).toBe('OPENCODE');
    const calls2: string[] = [];
    const reg2 = build(calls2, ok('glm-test', calls2), { healthy: { opencode: () => false } });
    const r = await reg2.select('AUTO').complete(req());
    expect([r.engine, r.mode, r.model]).toEqual(['OLLAMA', 'HYBRID', 'qwen']);
    expect(calls2).toEqual(['qwen']);
  });

  it('AUTO falls to the next engine on error, 429 and invalid output; a failed engine is not retried in the same request', async () => {
    for (const error of [new LlmUnavailableError('timeout'), new LlmRateLimitedError(5), new LlmInvalidOutputError('bad json')]) {
      const calls: string[] = [];
      const chain = build(calls, failing('glm-test', calls, error)).select('AUTO');
      expect((await chain.complete(req())).engine).toBe('OLLAMA');
      await chain.complete(req());
      expect(calls).toEqual(['glm-test', 'qwen', 'qwen']);
    }
  });

  it('explicit engine is used as is; if it fails the STUB answers and the model says so', async () => {
    const calls: string[] = [];
    const reg = build(calls, failing('glm-test', calls));
    const r = await reg.select('OPENCODE').complete(req());
    expect([r.engine, r.mode, r.model]).toEqual(['STUB', 'DETERMINISTIC', 'glm-test+stub-fallback']);
    expect(calls).toEqual(['glm-test', 'stub-deterministic-1']); // never Ollama: explicit means explicit
    const direct = await build([], ok('glm-test', [])).select('STUB').complete(req());
    expect([direct.engine, direct.model]).toEqual(['STUB', 'stub-deterministic-1']);
    // AUTO that ends in the stub after a failure also leaves a trace
    const c2: string[] = [];
    const r2 = await build(c2, failing('glm-test', c2), { healthy: { ollama: () => false } }).select('AUTO').complete(req());
    expect(r2.model).toBe('glm-test+stub-fallback');
  });

  it('circuit breaker: 3 failures take the engine out for 60 s, then it is probed again', async () => {
    let t = 1_000_000;
    const calls: string[] = [];
    let healthy = false;
    const reg = build(calls, { provider: 'x', complete: async () => (healthy ? ok('glm-test', calls).complete(req()) : (calls.push('glm-test'), Promise.reject(new LlmUnavailableError('down')))) }, { now: () => t });
    for (let i = 0; i < 3; i++) await reg.select('AUTO').complete(req());
    expect(calls.filter((c) => c === 'glm-test')).toHaveLength(3);
    expect((await reg.list())[0]?.available).toBe(false);
    await reg.select('AUTO').complete(req());
    expect(calls.filter((c) => c === 'glm-test')).toHaveLength(3); // skipped while open
    t += 61_000;
    healthy = true;
    expect((await reg.select('AUTO').complete(req())).engine).toBe('OPENCODE');
    expect((await reg.list())[0]?.available).toBe(true);
  });

  it('429 trips the breaker right away; LLM_FALLBACK=none ends in an error instead of the stub', async () => {
    const calls: string[] = [];
    const reg = build(calls, failing('glm-test', calls, new LlmRateLimitedError(120)), { order: ['opencode'], stubLast: false });
    await expect(reg.select('AUTO').complete(req())).rejects.toBeInstanceOf(LlmRateLimitedError);
    expect((await reg.list())[0]?.available).toBe(false);
  });

  it('external engines get pseudonymized requests, local ones do not', async () => {
    const seen: Record<string, string> = {};
    const spy = (id: string): LlmPort => ({ provider: id, complete: async (r) => ((seen[id] = JSON.stringify(r.messages)), ({ stopReason: 'end_turn', content: [{ type: 'text', text: 'Persona A' }], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: id }) as LlmResponse) });
    const reg = new LlmEngineRegistry([entry('opencode', 'OPENCODE', spy('ext'), 'm', () => true, true), entry('ollama', 'OLLAMA', spy('loc'), 'q'), entry('stub', 'STUB', ok('s', []), null)], { order: ['opencode', 'ollama'], stubLastResort: true });
    const messages = [{ role: 'user' as const, content: [{ type: 'tool_result' as const, toolUseId: 'a', content: '{"displayName":"Diego Flores"}' }] }];
    const r = await reg.select('OPENCODE').complete(req({ messages }));
    expect(seen.ext).not.toContain('Diego');
    expect((r.content[0] as { text: string }).text).toBe('Diego Flores');
    await reg.select('OLLAMA').complete(req({ messages }));
    expect(seen.loc).toContain('Diego Flores');
  });
});
