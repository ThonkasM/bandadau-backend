import type { Locale } from '../../entities/locale';

export type LlmTier = 'smart' | 'fast';
export interface LlmToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export type LlmBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: LlmBlock[];
}

/** What the call is for. Real providers ignore it; deterministic doubles/stub use it to pick a behavior. */
export type LlmPurpose = 'collect' | 'compose' | 'audio_script' | 'explain_alert' | 'correct';

export interface LlmRequest {
  tier: LlmTier;
  purpose: LlmPurpose;
  locale: Locale;
  system: string;
  messages: LlmMessage[];
  tools?: LlmToolDef[];
  maxTokens: number;
  /** JSON Schema for structured output (providers that cannot enforce it validate and retry once). */
  responseSchema?: Record<string, unknown>;
  effort?: 'low' | 'medium' | 'high';
  /** Plain facts about the request for deterministic doubles (question, today); real providers ignore them. */
  meta?: { question?: string; today?: string };
}
export interface LlmResponse {
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';
  content: LlmBlock[];
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  model: string;
}
export interface LlmPort {
  readonly provider: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}
export const LLM_PORT = Symbol('LlmPort');

/** Price in USD per million tokens (= micro-USD per token). */
export interface LlmPricing {
  inPerM: number;
  outPerM: number;
}
