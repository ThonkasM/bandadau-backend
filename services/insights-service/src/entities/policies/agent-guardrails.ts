import { type TokenUsage, totalTokens } from '../agent-run';
import { AgentStepLimitError } from '../errors/domain-errors';

/** Hard limits per execution (agentes-y-reportes-generativos.md 4.3, D8). */
export interface AgentGuardrails {
  maxSteps: number;
  maxTokens: number;
  maxToolCalls: number;
  maxDurationMs: number;
}

export const REPORT_GUARDRAILS = (maxSteps: number, maxTokens: number): AgentGuardrails => ({
  maxSteps,
  maxTokens,
  maxToolCalls: 16,
  maxDurationMs: 120_000,
});

export interface BudgetState {
  llmSteps: number;
  toolCalls: number;
  tokens: TokenUsage;
  startedAtMs: number;
}

/** Throws before another LLM step would exceed a limit. */
export function assertBudget(limits: AgentGuardrails, state: BudgetState, nowMs: number): void {
  if (state.llmSteps >= limits.maxSteps) throw new AgentStepLimitError('MAX_STEPS');
  if (totalTokens(state.tokens) >= limits.maxTokens) throw new AgentStepLimitError('MAX_TOKENS');
  if (state.toolCalls >= limits.maxToolCalls) throw new AgentStepLimitError('MAX_TOOL_CALLS');
  if (nowMs - state.startedAtMs > limits.maxDurationMs) throw new AgentStepLimitError('TIMEOUT');
}

/** Integer micro-dollars: price is USD per million tokens, expressed in micro-USD per token. */
export function costMicros(usage: TokenUsage, priceInPerM: number, priceOutPerM: number): number {
  return Math.round(usage.input * priceInPerM + usage.output * priceOutPerM);
}
