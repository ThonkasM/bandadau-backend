import type { LlmBlock, LlmMessage, LlmPort, LlmRequest, LlmResponse } from '../../../use-cases/ports/llm.port';
import { asUnavailable, flattenToolBlocks, mergeSameRole, textOf } from './common';

export interface OllamaOptions {
  url: string;
  model: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
}

/** Development provider (free, local): Ollama `/api/chat` with tool calling. Same model for both tiers. */
export class OllamaAdapter implements LlmPort {
  readonly provider = 'ollama';
  private readonly fetchImpl: typeof fetch;
  private seq = 0;

  constructor(private readonly o: OllamaOptions) {
    this.fetchImpl = o.fetch ?? fetch;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const withTools = Boolean(req.tools && req.tools.length > 0);
    const history = mergeSameRole(withTools ? req.messages : flattenToolBlocks(req.messages));
    const body: Record<string, unknown> = {
      model: this.o.model,
      stream: false,
      messages: [{ role: 'system', content: req.system }, ...history.flatMap(toOllama)],
      options: { num_predict: req.maxTokens, temperature: 0 },
      ...(withTools ? { tools: (req.tools ?? []).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })) } : {}),
      ...(req.responseSchema ? { format: req.responseSchema } : {}),
    };
    let json: { message?: OllamaMessage; prompt_eval_count?: number; eval_count?: number; done_reason?: string; model?: string };
    try {
      const res = await this.fetchImpl(`${this.o.url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 120_000),
      });
      if (!res.ok) throw Object.assign(new Error(await res.text()), { status: res.status, name: 'OllamaError' });
      json = (await res.json()) as typeof json;
    } catch (error) {
      return asUnavailable(error);
    }
    const msg = json.message ?? { role: 'assistant' as const, content: '' };
    const content: LlmBlock[] = [];
    if (msg.content) content.push({ type: 'text', text: msg.content });
    for (const call of msg.tool_calls ?? []) content.push({ type: 'tool_use', id: `call_${++this.seq}`, name: call.function.name, input: call.function.arguments ?? {} });
    const usedTools = content.some((b) => b.type === 'tool_use');
    return {
      stopReason: usedTools ? 'tool_use' : json.done_reason === 'length' ? 'max_tokens' : 'end_turn',
      content,
      usage: { inputTokens: json.prompt_eval_count ?? 0, outputTokens: json.eval_count ?? 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      model: json.model ?? this.o.model,
    };
  }
}

function toOllama(m: LlmMessage): OllamaMessage[] {
  if (m.role === 'assistant') {
    const calls = m.content.filter((b): b is Extract<LlmBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    return [{ role: 'assistant', content: textOf(m.content), ...(calls.length ? { tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: c.input } })) } : {}) }];
  }
  const results = m.content.filter((b): b is Extract<LlmBlock, { type: 'tool_result' }> => b.type === 'tool_result');
  const out: OllamaMessage[] = results.map((r) => ({ role: 'tool', content: r.content, tool_name: r.toolUseId }));
  const text = textOf(m.content);
  if (text) out.push({ role: 'user', content: text });
  return out;
}
