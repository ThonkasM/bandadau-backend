import type { AlertKind, AlertSeverity } from '../alert';

export interface HealthSnapshot {
  services: { name: string; status: 'UP' | 'DEGRADED' | 'DOWN'; error?: string | null }[];
  queues: { name: string; messagesReady: number; messagesUnacked: number; consumers: number; isDeadLetter: boolean }[];
}
export interface SagaSnapshot {
  failedRecent: number;
  compensatedLastHour: number;
  /** Failure reasons -> count (only reasons, never user data). */
  byFailureReason: Record<string, number>;
}
export interface ModerationSnapshot {
  totalPending: number;
  oldestEnqueuedAt: string | null;
}
export interface AnomalySnapshot {
  metric: string;
  at: string;
  value: number;
  expected: number;
  score: number;
  direction: 'SPIKE' | 'DROP';
}

export interface MonitoringThresholds {
  dlqCritical: number;
  queueBacklog: number;
  sagaFailedCritical: number;
  sagaCompensatedWarning: number;
  moderationPending: number;
  moderationAgeWarningMs: number;
  moderationAgeCriticalMs: number;
}
export const DEFAULT_THRESHOLDS: MonitoringThresholds = {
  dlqCritical: 50,
  queueBacklog: 1000,
  sagaFailedCritical: 5,
  sagaCompensatedWarning: 10,
  moderationPending: 20,
  moderationAgeWarningMs: 2 * 3_600_000,
  moderationAgeCriticalMs: 24 * 3_600_000,
};

export interface Finding {
  kind: AlertKind;
  severity: AlertSeverity;
  resource: string;
  /** Deterministic Spanish message (operational language of the team). */
  message: string;
  details: Record<string, unknown>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A service that fails /health/ready: WARNING; CRITICAL if its alert was already open in the previous run (2 consecutive failures). */
export function serviceDownFindings(health: HealthSnapshot, previouslyOpen: ReadonlySet<string>): Finding[] {
  return health.services
    .filter((s) => s.status === 'DOWN')
    .map((s) => ({
      kind: 'SERVICE_DOWN' as const,
      severity: previouslyOpen.has(`SERVICE_DOWN:${s.name}`) ? ('CRITICAL' as const) : ('WARNING' as const),
      resource: s.name,
      message: `${s.name} no responde a /health/ready${s.error ? ` (${s.error})` : ''}.`,
      details: { service: s.name, error: s.error ?? null },
    }));
}

export function queueFindings(health: HealthSnapshot, t: MonitoringThresholds): Finding[] {
  const out: Finding[] = [];
  for (const q of health.queues) {
    if (q.isDeadLetter && q.messagesReady > 0) {
      out.push({
        kind: 'DLQ_BACKLOG',
        severity: q.messagesReady > t.dlqCritical ? 'CRITICAL' : 'WARNING',
        resource: q.name,
        message: `La cola ${q.name} acumula ${plural(q.messagesReady, 'mensaje', 'mensajes')} en dead letters.`,
        details: { queue: q.name, messagesReady: q.messagesReady, threshold: t.dlqCritical },
      });
    } else if (!q.isDeadLetter && q.messagesReady > t.queueBacklog) {
      out.push({
        kind: 'DLQ_BACKLOG',
        severity: 'WARNING',
        resource: q.name,
        message: `La cola ${q.name} tiene ${q.messagesReady} mensajes pendientes (umbral ${t.queueBacklog}); posible consumidor lento.`,
        details: { queue: q.name, messagesReady: q.messagesReady, consumers: q.consumers, threshold: t.queueBacklog },
      });
    }
  }
  return out;
}

export function sagaFindings(s: SagaSnapshot, t: MonitoringThresholds): Finding[] {
  const out: Finding[] = [];
  if (s.failedRecent >= 1) {
    out.push({
      kind: 'SAGA_FAILURES',
      severity: s.failedRecent >= t.sagaFailedCritical ? 'CRITICAL' : 'WARNING',
      resource: 'saga-failed',
      message: `${plural(s.failedRecent, 'SAGA fallida', 'SAGAs fallidas')} en los últimos 15 minutos (umbral crítico ${t.sagaFailedCritical}).`,
      details: { window: '15m', failedSagas: s.failedRecent, threshold: t.sagaFailedCritical, byFailureReason: s.byFailureReason },
    });
  }
  if (s.compensatedLastHour > t.sagaCompensatedWarning) {
    out.push({
      kind: 'SAGA_FAILURES',
      severity: 'WARNING',
      resource: 'saga-compensated',
      message: `${s.compensatedLastHour} inscripciones compensadas en la última hora (umbral ${t.sagaCompensatedWarning}).`,
      details: { window: '1h', compensatedSagas: s.compensatedLastHour, threshold: t.sagaCompensatedWarning },
    });
  }
  return out;
}

export function moderationFindings(m: ModerationSnapshot, nowMs: number, t: MonitoringThresholds): Finding[] {
  if (m.totalPending <= t.moderationPending || !m.oldestEnqueuedAt) return [];
  const age = nowMs - Date.parse(m.oldestEnqueuedAt);
  if (!(age > t.moderationAgeWarningMs)) return [];
  const hours = Math.floor(age / 3_600_000);
  return [
    {
      kind: 'MODERATION_BACKLOG',
      severity: age > t.moderationAgeCriticalMs ? 'CRITICAL' : 'WARNING',
      resource: 'moderation-queue',
      message: `${m.totalPending} contenidos esperan moderación; el más antiguo lleva ${hours} h.`,
      details: { totalPending: m.totalPending, oldestEnqueuedAt: m.oldestEnqueuedAt, ageHours: hours },
    },
  ];
}

const ZERO_IS_CRITICAL = new Set(['registrationsConfirmed', 'sagaCompensations']);

export function anomalyFindings(anomalies: AnomalySnapshot[]): Finding[] {
  return anomalies.map((a) => ({
    kind: 'METRIC_ANOMALY' as const,
    severity: ZERO_IS_CRITICAL.has(a.metric) && a.value === 0 && a.direction === 'DROP' ? ('WARNING' as const) : ('INFO' as const),
    resource: a.metric,
    message: `Valor anómalo en ${a.metric} el ${a.at}: ${a.value} (esperado ~${Math.round(a.expected)}, ${a.direction === 'SPIKE' ? 'pico' : 'caída'}).`,
    details: { metric: a.metric, at: a.at, value: a.value, expected: a.expected, score: a.score, direction: a.direction },
  }));
}
