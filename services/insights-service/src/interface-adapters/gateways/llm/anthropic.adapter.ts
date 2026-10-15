import Anthropic from '@anthropic-ai/sdk';

import type { LlmBlock, LlmMessage, LlmPort, LlmRequest, LlmResponse } from '../../../use-cases/ports/llm.port';
import { asUnavailable, flattenToolBlocks } from './common';

export interface AnthropicOptions {
  apiKey: string | undefined;
  model: string;
  modelCheap: string;
  timeoutMs?: number;
  /** Tests inject a fake client; production builds the official SDK client. */
  client?: Pick<Anthropic, 'messages'>;
}

type Stop = LlmResponse['stopReason'];
const STOP: Record<string, Stop> = { end_turn: 'end_turn', tool_use: 'tool_use', max_tokens: 'max_tokens', refusal: 'refusal', stop_sequence: 'end_turn' };

/**
 * Anthropic Messages API (official SDK, never imported outside this folder). `smart` -> sonnet, `fast` -> haiku.
 * No API key => `enabled = false` and the composition root falls back to the deterministic stub.
 */
export class AnthropicAdapter implements LlmPort {
  readonly provider = 'claude';
  readonly enabled: boolean;
  private readonly client: Pick<Anthropic, 'messages'> | undefined;

  constructor(private readonly o: AnthropicOptions) {
    this.enabled = Boolean(o.client ?? o.apiKey);
    this.client = o.client ?? (o.apiKey ? new Anthropic({ apiKey: o.apiKey, timeout: o.timeoutMs ?? 60_000, maxRetries: 2 }) : undefined);
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (!this.client) throw new Error('AnthropicAdapter is disabled: ANTHROPIC_API_KEY is not set');
    const model = req.tier === 'smart' ? this.o.model : this.o.modelCheap;
    const withTools = Boolean(req.tools && req.tools.length > 0);
    const messages = (withTools ? req.messages : flattenToolBlocks(req.messages)).map(toAnthropicMessage);
    const params: Record<string, unknown> = {
      model,
      max_tokens: req.maxTokens,
      // system prompt is the stable prefix: cache it (no date/run id inside, see agentes-y-reportes-generativos.md 3.1)
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages,
      output_config: {
        ...(req.effort ? { effort: req.effort } : {}),
        ...(req.responseSchema ? { format: { type: 'json_schema', schema: req.responseSchema } } : {}),
      },
    };
    if (withTools) params.tools = (req.tools ?? []).map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
    let res: Anthropic.Message;
    try {
      res = (await this.client.messages.create(params as unknown as Anthropic.MessageCreateParamsNonStreaming)) as Anthropic.Message;
    } catch (error) {
      return asUnavailable(error);
    }
    const content: LlmBlock[] = [];
    for (const b of res.content) {
      if (b.type === 'text') content.push({ type: 'text', text: b.text });
      else if (b.type === 'tool_use') content.push({ type: 'tool_use', id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> });
    }
    return {
      stopReason: STOP[res.stop_reason ?? 'end_turn'] ?? 'other',
      content,
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      },
      model: res.model ?? model,
    };
  }
}

function toAnthropicMessage(m: LlmMessage): Anthropic.MessageParam {
  return {
    role: m.role,
    content: m.content.map((b) => {
      switch (b.type) {
        case 'text':
          return { type: 'text' as const, text: b.text };
        case 'tool_use':
          return { type: 'tool_use' as const, id: b.id, name: b.name, input: b.input };
        case 'tool_result':
          return { type: 'tool_result' as const, tool_use_id: b.toolUseId, content: b.content, ...(b.isError ? { is_error: true } : {}) };
      }
    }),
  };
}
