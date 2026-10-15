import type { InsightsAlertDto } from '../../data-sources/types';
import type { GatewayContext } from '../../graphql/context';
import type { BusEvent, RabbitEventBus } from '../../graphql/pubsub/rabbit-event-bus';
import type { InsightsService } from './insights.service';

export const ALERT_RAISED = 'bandada.insights.alert.raised.v1';
export const REPORT_READY = 'bandada.insights.report.ready.v1';
/** Extra bindings of the instance queue (`admin-gateway.subscriptions.<instanceId>`). */
export const INSIGHTS_BINDINGS = [ALERT_RAISED, REPORT_READY];

const RANK = { INFO: 0, WARNING: 1, CRITICAL: 2 } as const;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** `bandada.insights.alert.raised.v1` -> the Alert the panel shows (the event carries everything it needs). */
export function alertFromEvent(event: BusEvent): InsightsAlertDto {
  const d = event.data ?? {};
  const details = (d.details && typeof d.details === 'object' ? d.details : {}) as Record<string, unknown>;
  return {
    id: str(d.alertId),
    severity: (str(d.severity) || 'INFO') as InsightsAlertDto['severity'],
    kind: str(d.kind),
    message: str(d.message),
    details,
    status: 'OPEN',
    source: 'MONITORING_AGENT',
    agentRunId: typeof d.agentRunId === 'string' ? d.agentRunId : null,
    raisedAt: str(d.occurredAt) || event.time || new Date().toISOString(),
    acknowledgedAt: null,
    acknowledgedBy: null,
    resource: str(details.service ?? details.queue ?? details.metric ?? details.authorId) || null,
    occurrences: 1,
  };
}

export function insightsSubscriptions(bus: RabbitEventBus, service: InsightsService) {
  return {
    Subscription: {
      alertRaised: {
        subscribe: async function* (_: unknown, args: { minSeverity?: keyof typeof RANK | null }) {
          const min = args.minSeverity ? RANK[args.minSeverity] : 0;
          for await (const event of bus.iterate([ALERT_RAISED])) {
            const alert = alertFromEvent(event);
            if (alert.id && (RANK[alert.severity] ?? 0) >= min) yield { alertRaised: alert };
          }
        },
        resolve: (payload: { alertRaised: unknown }) => payload.alertRaised,
      },
      reportReady: {
        subscribe: async function* (_: unknown, args: { id: string }, ctx: GatewayContext) {
          // subscribe first, then check the current state: a report that finished before the subscription started is delivered too
          const events = bus.iterate([REPORT_READY]);
          const current = await service.report(ctx, args.id);
          if (current && (current.status === 'READY' || current.status === 'FAILED')) {
            yield { reportReady: current };
            await events.return(undefined);
            return;
          }
          for await (const event of events) {
            if (event.data?.reportId !== args.id) continue;
            const report = await service.report(ctx, args.id);
            if (report) yield { reportReady: report };
            return;
          }
        },
        resolve: (payload: { reportReady: unknown }) => payload.reportReady,
      },
    },
  };
}
