import type { Locale } from './locale';

export type AgentKind = 'MONITORING' | 'REPORT' | 'EXTERNAL_MCP';
export type AgentTrigger = 'SCHEDULE' | 'MANUAL' | 'REPORT_REQUEST';
export type AgentRunStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ABORTED';
export type StopReason = 'COMPLETED' | 'MAX_STEPS' | 'MAX_TOKENS' | 'MAX_TOOL_CALLS' | 'TIMEOUT' | 'ERROR';

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
export const emptyUsage = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

export interface AgentRunStep {
  index: number;
  kind: 'LLM' | 'TOOL_CALL';
  toolName: string | null;
  input: Record<string, unknown> | null;
  /** Truncated (<= 2 KB), never personal data. */
  outputSummary: string | null;
  isError: boolean;
  startedAt: string;
  durationMs: number;
  usage?: TokenUsage;
}

export interface AgentRun {
  id: string;
  agent: AgentKind;
  trigger: AgentTrigger;
  requestedBy: string;
  locale: Locale;
  status: AgentRunStatus;
  llmProvider: string | null;
  model: string | null;
  promptVersion: string | null;
  toolsUsed: string[];
  stepCount: number;
  llmSteps: number;
  tokens: TokenUsage;
  /** Integer micro-dollars (never float). */
  costUsdMicros: number;
  reportId: string | null;
  alertIds: string[];
  error: { code: string; message: string } | null;
  stopReason: StopReason | null;
  startedAt: string;
  finishedAt: string | null;
}

export function newAgentRun(i: {
  id: string;
  agent: AgentKind;
  trigger: AgentTrigger;
  requestedBy: string;
  locale: Locale;
  now: string;
  reportId?: string | null;
  promptVersion?: string | null;
}): AgentRun {
  return {
    id: i.id,
    agent: i.agent,
    trigger: i.trigger,
    requestedBy: i.requestedBy,
    locale: i.locale,
    status: 'RUNNING',
    llmProvider: null,
    model: null,
    promptVersion: i.promptVersion ?? null,
    toolsUsed: [],
    stepCount: 0,
    llmSteps: 0,
    tokens: emptyUsage(),
    costUsdMicros: 0,
    reportId: i.reportId ?? null,
    alertIds: [],
    error: null,
    stopReason: null,
    startedAt: i.now,
    finishedAt: null,
  };
}

export const totalTokens = (t: TokenUsage): number => t.input + t.output;
