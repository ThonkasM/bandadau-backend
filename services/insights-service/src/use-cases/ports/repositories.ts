import type { AgentKind, AgentRun, AgentRunStep } from '../../entities/agent-run';
import type { Alert, AlertSeverity, AlertStatus } from '../../entities/alert';
import type { MetricDelta, MetricName, MetricPoint } from '../../entities/metric-point';
import type { GeneratedReport, ReportStatus } from '../../entities/report';
import type { OutboundMessage } from './misc';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ReportRepository {
  save(report: GeneratedReport, messages?: OutboundMessage[]): Promise<void>;
  findById(id: string): Promise<GeneratedReport | null>;
  list(q: { status?: ReportStatus; cursor?: string; limit: number }): Promise<Page<GeneratedReport>>;
  /** Reports left PENDING/RUNNING by a previous process. */
  listUnfinished(): Promise<GeneratedReport[]>;
}
export const REPORT_REPOSITORY = Symbol('ReportRepository');

export interface AgentRunRepository {
  create(run: AgentRun): Promise<void>;
  update(run: AgentRun): Promise<void>;
  appendStep(runId: string, step: AgentRunStep): Promise<void>;
  findById(id: string): Promise<{ run: AgentRun; steps: AgentRunStep[] } | null>;
  list(q: { agent?: AgentKind; cursor?: string; limit: number }): Promise<Page<AgentRun>>;
}
export const AGENT_RUN_REPOSITORY = Symbol('AgentRunRepository');

export interface AlertRepository {
  save(alert: Alert, messages?: OutboundMessage[]): Promise<void>;
  findById(id: string): Promise<Alert | null>;
  findActiveByFingerprint(fingerprint: string): Promise<Alert | null>;
  /** OPEN + ACKNOWLEDGED. */
  listActive(): Promise<Alert[]>;
  list(q: { status?: AlertStatus; severity?: AlertSeverity; cursor?: string; limit: number }): Promise<Page<Alert>>;
  countOpen(): Promise<number>;
}
export const ALERT_REPOSITORY = Symbol('AlertRepository');

export interface MetricRepository {
  series(name: MetricName, from: string, to: string): Promise<MetricPoint[]>;
  /** Used by tests and by the analytics consumer outside a transaction. */
  increment(deltas: MetricDelta[]): Promise<void>;
}
export const METRIC_REPOSITORY = Symbol('MetricRepository');

/** Lease-based lock (LOCK#<name> in DynamoDB). */
export interface LockPort {
  tryAcquire(name: string, ttlMs: number, owner: string): Promise<boolean>;
  holder(name: string): Promise<string | null>;
  release(name: string, owner: string): Promise<void>;
}
export const LOCK_PORT = Symbol('LockPort');
