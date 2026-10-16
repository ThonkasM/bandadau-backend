import type { Locale } from './locale';
import type { ConcreteEngine, EngineMode } from './report-engine';

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

/** Result of the figure/format verification of the final text (never shown to the user; ADR-0022 / agentes-y-reportes-generativos §4.4). */
export interface RunVerification {
  passed: boolean;
  /** Silent regenerations performed (0 or 1). */
  retries: number;
  unsupportedNumbers: number[];
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
  /** Real engine and mode (AGENT|HYBRID|DETERMINISTIC) that served the run (ADR-0022). */
  engine?: ConcreteEngine | null;
  engineMode?: EngineMode | null;
  verification?: RunVerification | null;
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
    engine: null,
    engineMode: null,
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

/** Records who really answered an LLM call (engine and mode set by the engine chain; ADR-0022). */
export function noteEngine(run: AgentRun, res: { engine?: ConcreteEngine | undefined; mode?: EngineMode | undefined }): void {
  if (res.engine) {
    run.engine = res.engine;
    run.engineMode = res.mode ?? null;
  }
}
