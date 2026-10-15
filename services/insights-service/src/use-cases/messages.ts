import type { Alert } from '../entities/alert';
import type { GeneratedReport } from '../entities/report';
import type { OutboundMessage } from './ports/misc';

export const ALERT_RAISED = 'bandada.insights.alert.raised.v1';
export const REPORT_READY = 'bandada.insights.report.ready.v1';

export function alertRaisedMessage(alert: Alert, now: string, correlationId?: string): OutboundMessage {
  return {
    type: ALERT_RAISED,
    subject: `alerts/${alert.id}`,
    correlationId,
    data: {
      alertId: alert.id,
      severity: alert.severity,
      kind: alert.kind,
      message: alert.message,
      details: alert.details,
      agentRunId: alert.agentRunId,
      occurredAt: now,
    },
  };
}

export function reportReadyMessage(report: GeneratedReport, now: string): OutboundMessage {
  return {
    type: REPORT_READY,
    subject: `reports/${report.id}`,
    correlationId: report.agentRunId ?? undefined,
    data: {
      reportId: report.id,
      requestedBy: report.requestedBy,
      status: report.status,
      title: report.title,
      locale: report.locale,
      hasAudio: report.audioKey !== null,
      occurredAt: now,
    },
  };
}
