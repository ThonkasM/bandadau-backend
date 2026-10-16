import { randomBytes } from 'node:crypto';

import Ajv, { type ValidateFunction } from 'ajv';

import type { LlmBlock, LlmMessage, LlmPort, LlmRequest, LlmResponse, LlmToolDef } from '../../../use-cases/ports/llm.port';
import { flattenToolBlocks, mergeSameRole, textOf } from './common';
import { LlmAuthError, LlmBadRequestError, LlmInvalidOutputError, LlmNetworkError, LlmNotFoundError, LlmRateLimitedError, LlmServerError, parseRetryAfter } from './llm-errors';
import { modelRejection } from './model-policy';

export interface OpenAiCompatibleOptions {
  /** Never logged and never part of an error message. */
  apiKey: string | undefined;
  /** e.g. `https://opencode.ai/inference/go` */
  baseUrl: string;
  /** Primary chat path, e.g. `/openai/v1/chat/completions`. */
  chatPath: string;
  /** Tried, in order, when the primary path answers 404 (the working one is remembered). */
  altChatPaths?: string[];
  model: string;
  allowedModels?: string[];
  /** Identifies this client to the provider (OpenCode asks every client to send its own). */
  userAgent: string;
  timeoutMs?: number;
  /** Extra attempts on network errors, timeouts and 5xx (not on 4xx). */
  maxRetries?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface WireToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: unknown };
}
interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}
interface WireResponse {
  model?: string;
  choices?: { message?: { content?: unknown; tool_calls?: WireToolCall[] }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

const PROCESS_ID = randomBytes(4).toString('hex');
const ajv = new Ajv({ strict: false, allErrors: false });
const MIN_OUTPUT_TOKENS = 1024; // reasoning models spend part of the budget thinking

/** Chat Completions (OpenAI-compatible) client: OpenCode Go and any similar gateway. Tool calling is native (`tools` / `tool_calls`). */
export class OpenAiCompatibleAdapter implements LlmPort {
  readonly provider = 'opencode';
  /** Why it cannot be used, or null. The key itself is never reported. */
  readonly disabledReason: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly paths: string[];
  private goodPath: string | null = null;
  private jsonModeOk = true;
  private readonly validators = new Map<string, ValidateFunction | null>();

  constructor(private readonly o: OpenAiCompatibleOptions) {
    this.fetchImpl = o.fetch ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.paths = [o.chatPath, ...(o.altChatPaths ?? [])].filter((p, i, a) => a.indexOf(p) === i);
    this.disabledReason = !o.apiKey ? 'OPENCODE_API_KEY is not set' : modelRejection(o.model, o.allowedModels ?? []);
  }

  get enabled(): boolean {
    return this.disabledReason === null;
  }

  get model(): string {
    return this.o.model;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (!this.o.apiKey) throw new LlmAuthError(0, 'OPENCODE_API_KEY is not set');
    if (this.disabledReason) throw new LlmInvalidOutputError(this.disabledReason);
    const offered = req.tools ?? [];
    let extra: LlmMessage[] = [];
    for (let attempt = 0; ; attempt++) {
      const res = await this.once(req, extra);
      const problem = this.checkToolCalls(res.content, offered);
      if (!problem) return res;
      if (attempt >= 1) throw new LlmInvalidOutputError(problem);
      // one repair attempt: tell the model what was wrong (the invalid call is not replayed)
      extra = [{ role: 'user', content: [{ type: 'text', text: `Your last tool call was invalid (${problem}). Call only the listed tools, with arguments that match their JSON schema.` }] }];
    }
  }

  private async once(req: LlmRequest, extra: LlmMessage[]): Promise<LlmResponse> {
    const withTools = Boolean(req.tools && req.tools.length > 0);
    const history = mergeSameRole([...(withTools ? req.messages : flattenToolBlocks(req.messages)), ...extra]);
    const jsonMode = Boolean(req.responseSchema) && this.jsonModeOk;
    const schemaHint = req.responseSchema ? `\n\nReply with ONE JSON object only (no code fences, no commentary) that conforms to this JSON Schema:\n${JSON.stringify(req.responseSchema)}` : '';
    const body: Record<string, unknown> = {
      model: this.o.model,
      stream: false,
      max_tokens: Math.max(req.maxTokens, MIN_OUTPUT_TOKENS),
      messages: [{ role: 'system', content: `${req.system}${schemaHint}` } satisfies WireMessage, ...history.flatMap(toWire)],
      ...(withTools ? { tools: (req.tools ?? []).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })), tool_choice: 'auto' } : {}),
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    };
    let json: WireResponse;
    try {
      json = await this.post(body, req.sessionId);
    } catch (error) {
      if (error instanceof LlmBadRequestError && jsonMode) {
        this.jsonModeOk = false; // this gateway/model does not accept response_format: rely on the schema in the prompt
        delete body.response_format;
        json = await this.post(body, req.sessionId);
      } else throw error;
    }
    return this.toResponse(json, Boolean(req.responseSchema));
  }

  private toResponse(json: WireResponse, structured: boolean): LlmResponse {
    const choice = json.choices?.[0];
    if (!choice?.message) throw new LlmInvalidOutputError('the response has no choices');
    const content: LlmBlock[] = [];
    let text = contentText(choice.message.content);
    if (structured) text = extractJson(text);
    if (text) content.push({ type: 'text', text });
    let seq = 0;
    for (const call of choice.message.tool_calls ?? []) {
      const name = call.function?.name;
      if (!name) throw new LlmInvalidOutputError('a tool call has no name');
      content.push({ type: 'tool_use', id: call.id || `call_${++seq}`, name, input: parseArgs(call.function?.arguments) });
    }
    const usedTools = content.some((b) => b.type === 'tool_use');
    const finish = choice.finish_reason;
    return {
      stopReason: usedTools ? 'tool_use' : finish === 'length' ? 'max_tokens' : finish === 'content_filter' ? 'refusal' : 'end_turn',
      content,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        cacheReadTokens: json.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: 0,
      },
      model: json.model || this.o.model,
    };
  }

  /** null when every tool call names an offered tool and its arguments satisfy the tool's input schema. */
  private checkToolCalls(content: LlmBlock[], offered: LlmToolDef[]): string | null {
    for (const b of content) {
      if (b.type !== 'tool_use') continue;
      const tool = offered.find((t) => t.name === b.name);
      if (!tool) return `unknown tool ${b.name}`;
      const validate = this.validatorFor(tool);
      if (validate && !validate(b.input)) return `arguments of ${b.name} do not match its schema: ${ajv.errorsText(validate.errors, { dataVar: 'args' }).slice(0, 160)}`;
    }
    return null;
  }

  private validatorFor(tool: LlmToolDef): ValidateFunction | null {
    const key = `${tool.name}:${JSON.stringify(tool.inputSchema)}`;
    if (!this.validators.has(key)) {
      try {
        this.validators.set(key, ajv.compile(tool.inputSchema));
      } catch {
        this.validators.set(key, null); // a schema we cannot compile is not a reason to fail the report: the MCP server validates again
      }
    }
    return this.validators.get(key) ?? null;
  }

  private async post(body: Record<string, unknown>, sessionId: string | undefined): Promise<WireResponse> {
    const ordered = this.goodPath ? [this.goodPath, ...this.paths.filter((p) => p !== this.goodPath)] : this.paths;
    let notFound: LlmNotFoundError | null = null;
    for (const path of ordered) {
      try {
        const json = await this.postWithRetries(`${this.o.baseUrl.replace(/\/+$/, '')}${path}`, body, sessionId);
        this.goodPath = path;
        return json;
      } catch (error) {
        if (error instanceof LlmNotFoundError) {
          notFound = error; // wrong route: try the alternative one
          continue;
        }
        throw error;
      }
    }
    throw notFound ?? new LlmNotFoundError();
  }

  private async postWithRetries(url: string, body: Record<string, unknown>, sessionId: string | undefined): Promise<WireResponse> {
    const attempts = (this.o.maxRetries ?? 1) + 1;
    let last: Error = new LlmNetworkError();
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await this.sleep(250 * 2 ** (i - 1));
      try {
        return await this.postOnce(url, body, sessionId);
      } catch (error) {
        last = error as Error;
        if (!(error instanceof LlmNetworkError || error instanceof LlmServerError)) throw error; // 4xx are final
      }
    }
    throw last;
  }

  private async postOnce(url: string, body: Record<string, unknown>, sessionId: string | undefined): Promise<WireResponse> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${this.o.apiKey}`,
          'User-Agent': this.o.userAgent,
          'x-opencode-session': `bandada-${PROCESS_ID}-${sessionId ?? 'process'}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 60_000),
      });
    } catch (error) {
      throw new LlmNetworkError(`${(error as Error).name}: ${(error as Error).message.slice(0, 120)}`);
    }
    if (res.ok) {
      try {
        return (await res.json()) as WireResponse;
      } catch {
        throw new LlmInvalidOutputError('the response is not JSON');
      }
    }
    const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
    if (res.status === 401 || res.status === 403) throw new LlmAuthError(res.status, detail);
    if (res.status === 404) throw new LlmNotFoundError(detail);
    if (res.status === 429) throw new LlmRateLimitedError(parseRetryAfter(res.headers.get('retry-after')), detail);
    if (res.status >= 500) throw new LlmServerError(res.status, detail);
    throw new LlmBadRequestError(res.status, detail);
  }
}

function toWire(m: LlmMessage): WireMessage[] {
  if (m.role === 'assistant') {
    const calls = m.content.filter((b): b is Extract<LlmBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    return [
      {
        role: 'assistant',
        content: textOf(m.content) || (calls.length ? null : ''), // a null content is only valid next to tool_calls
        ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}),
      },
    ];
  }
  const out: WireMessage[] = m.content
    .filter((b): b is Extract<LlmBlock, { type: 'tool_result' }> => b.type === 'tool_result')
    .map((r) => ({ role: 'tool', tool_call_id: r.toolUseId, content: r.content }));
  const text = textOf(m.content);
  if (text) out.push({ role: 'user', content: text });
  return out;
}

function contentText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : '')).join('');
  return '';
}

/** Models like to wrap JSON in code fences or add a sentence: keep the outermost object. */
function extractJson(text: string): string {
  const t = text.trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  return start >= 0 && end > start ? t.slice(start, end + 1) : t;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw === 'string') {
    try {
      const v: unknown = JSON.parse(raw);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* falls through */
    }
  }
  throw new LlmInvalidOutputError('tool call arguments are not a JSON object');
}
