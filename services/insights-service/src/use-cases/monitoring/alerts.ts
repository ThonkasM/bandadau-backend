import { acknowledge, type Alert, type AlertKind, type AlertSeverity, type AlertSource, type AlertStatus, newAlert, recordOccurrence } from '../../entities/alert';
import { AlertConflictError, AlertNotFoundError } from '../../entities/errors/domain-errors';
import { alertRaisedMessage } from '../messages';
import type { Clock, IdGenerator } from '../ports/misc';
import type { AlertRepository, Page } from '../ports/repositories';

export interface RaiseAlertInput {
  severity: AlertSeverity;
  kind: AlertKind;
  message: string;
  details?: Record<string, unknown>;
  /** Contract field of the MCP tool; REST internal callers (n8n) omit it and a fingerprint is derived. */
  dedupeKey?: string;
  resource?: string | null;
  source: AlertSource;
  agentRunId?: string | null;
  correlationId?: string;
}
export interface RaiseAlertResult {
  alert: Alert;
  created: boolean;
  escalated: boolean;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);

export function deriveFingerprint(i: Pick<RaiseAlertInput, 'kind' | 'dedupeKey' | 'resource' | 'details' | 'message'>): { fingerprint: string; resource: string | null } {
  if (i.dedupeKey) {
    const prefix = `${i.kind}:`;
    return { fingerprint: i.dedupeKey, resource: i.dedupeKey.startsWith(prefix) ? i.dedupeKey.slice(prefix.length) : i.dedupeKey };
  }
  const d = i.details ?? {};
  const resource = i.resource ?? (typeof d.resource === 'string' ? d.resource : typeof d.authorId === 'string' ? d.authorId : slug(i.message));
  return { fingerprint: `${i.kind}:${resource}`, resource };
}

/** RaiseAlert: same use case behind MCP `raise_alert` and REST `raiseAlert`. Dedupe by fingerprint; outbox event only when new or escalated. */
export class RaiseAlertUseCase {
  constructor(
    private readonly alerts: AlertRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: RaiseAlertInput): Promise<RaiseAlertResult> {
    const now = this.clock.now().toISOString();
    const { fingerprint, resource } = deriveFingerprint(input);
    const existing = await this.alerts.findActiveByFingerprint(fingerprint);
    if (existing) {
      const { alert, escalated } = recordOccurrence(existing, input.severity, now, input.message);
      await this.alerts.save(alert, escalated ? [alertRaisedMessage(alert, now, input.correlationId)] : []);
      return { alert, created: false, escalated };
    }
    const alert = newAlert({
      id: this.ids.next(),
      now,
      severity: input.severity,
      kind: input.kind,
      message: input.message,
      details: input.details,
      source: input.source,
      agentRunId: input.agentRunId,
      resource,
      fingerprint,
    });
    await this.alerts.save(alert, [alertRaisedMessage(alert, now, input.correlationId)]);
    return { alert, created: true, escalated: false };
  }
}

export class AcknowledgeAlertUseCase {
  constructor(
    private readonly alerts: AlertRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: { alertId: string; by: string; note?: string }): Promise<Alert> {
    const alert = await this.alerts.findById(input.alertId);
    if (!alert) throw new AlertNotFoundError();
    if (alert.status === 'RESOLVED') throw new AlertConflictError();
    const next = acknowledge(alert, input.by, this.clock.now().toISOString(), input.note);
    if (next !== alert) await this.alerts.save(next);
    return next;
  }
}

export class ListAlertsUseCase {
  constructor(private readonly alerts: AlertRepository) {}
  execute(q: { status?: AlertStatus; severity?: AlertSeverity; cursor?: string; limit: number }): Promise<Page<Alert>> {
    return this.alerts.list(q);
  }
}
