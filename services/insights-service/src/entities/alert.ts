export const ALERT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];
export const ALERT_KINDS = ['SERVICE_DOWN', 'SAGA_FAILURES', 'DLQ_BACKLOG', 'MODERATION_BACKLOG', 'METRIC_ANOMALY', 'MODERATION_ESCALATION'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];
export const ALERT_SOURCES = ['MONITORING_AGENT', 'N8N', 'MANUAL'] as const;
export type AlertSource = (typeof ALERT_SOURCES)[number];

export interface Alert {
  id: string;
  severity: AlertSeverity;
  kind: AlertKind;
  message: string;
  /** LLM (or template) explanation; empty when the model is unavailable (A3). */
  explanation: string | null;
  details: Record<string, unknown>;
  status: AlertStatus;
  source: AlertSource;
  agentRunId: string | null;
  raisedAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  note: string | null;
  resource: string | null;
  fingerprint: string;
  occurrences: number;
  /** Consecutive monitoring runs in which the condition was not detected (auto-resolution after 3). */
  quietRuns: number;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

const RANK: Record<AlertSeverity, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };
export const severityRank = (s: AlertSeverity): number => RANK[s];
export const maxSeverity = (a: AlertSeverity, b: AlertSeverity): AlertSeverity => (RANK[a] >= RANK[b] ? a : b);

/** `kind + ':' + resource` (agentes-y-reportes-generativos.md 6.3). */
export const fingerprintOf = (kind: AlertKind, resource: string | null | undefined): string => `${kind}:${resource ?? '*'}`;

export interface NewAlertInput {
  id: string;
  now: string;
  severity: AlertSeverity;
  kind: AlertKind;
  message: string;
  details?: Record<string, unknown>;
  source: AlertSource;
  agentRunId?: string | null;
  resource?: string | null;
  fingerprint?: string;
  explanation?: string | null;
}

export function newAlert(i: NewAlertInput): Alert {
  const resource = i.resource ?? null;
  return {
    id: i.id,
    severity: i.severity,
    kind: i.kind,
    message: i.message,
    explanation: i.explanation ?? null,
    details: i.details ?? {},
    status: 'OPEN',
    source: i.source,
    agentRunId: i.agentRunId ?? null,
    raisedAt: i.now,
    lastSeenAt: i.now,
    acknowledgedAt: null,
    acknowledgedBy: null,
    note: null,
    resource,
    fingerprint: i.fingerprint ?? fingerprintOf(i.kind, resource),
    occurrences: 1,
    quietRuns: 0,
    resolvedAt: null,
    resolvedBy: null,
  };
}

/** Same problem seen again: bump `occurrences`/`lastSeenAt`; severity can only escalate. Returns whether it escalated. */
export function recordOccurrence(alert: Alert, severity: AlertSeverity, now: string, message?: string): { alert: Alert; escalated: boolean } {
  const escalated = RANK[severity] > RANK[alert.severity];
  return {
    escalated,
    alert: {
      ...alert,
      severity: escalated ? severity : alert.severity,
      message: message ?? alert.message,
      lastSeenAt: now,
      occurrences: alert.occurrences + 1,
      quietRuns: 0,
    },
  };
}

export function acknowledge(alert: Alert, by: string, now: string, note?: string): Alert {
  if (alert.status !== 'OPEN') return alert; // idempotent
  return { ...alert, status: 'ACKNOWLEDGED', acknowledgedAt: now, acknowledgedBy: by, note: note ?? alert.note };
}

export function resolve(alert: Alert, by: 'SYSTEM' | string, now: string): Alert {
  return { ...alert, status: 'RESOLVED', resolvedAt: now, resolvedBy: by };
}

export const QUIET_RUNS_TO_RESOLVE = 3;
