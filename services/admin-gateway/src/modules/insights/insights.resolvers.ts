import type { InsightsAgentRunDto, InsightsAlertDto, InsightsReportDto } from '../../data-sources/types';
import type { GatewayContext } from '../../graphql/context';
import type { InsightsService } from './insights.service';

type Ctx = GatewayContext;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function insightsResolvers(service: InsightsService) {
  return {
    Query: {
      reports: (_: unknown, args: never, ctx: Ctx) => service.reports(ctx, args),
      report: (_: unknown, args: { id: string }, ctx: Ctx) => service.report(ctx, args.id),
      alerts: (_: unknown, args: never, ctx: Ctx) => service.alerts(ctx, args),
      agentRuns: (_: unknown, args: never, ctx: Ctx) => service.agentRuns(ctx, args),
    },
    Mutation: {
      requestReport: (_: unknown, args: { question: string; locale?: string }, ctx: Ctx) => service.requestReport(ctx, args),
      acknowledgeAlert: (_: unknown, args: { id: string }, ctx: Ctx) => service.acknowledgeAlert(ctx, args.id),
      runMonitoringNow: (_: unknown, __: unknown, ctx: Ctx) => service.runMonitoringNow(ctx),
    },
    GeneratedReport: {
      // `system:<client>` requesters (n8n, monitoring) are not users
      requestedBy: (r: InsightsReportDto, _: unknown, ctx: Ctx) => (UUID.test(r.requestedBy) ? ctx.loaders.users.load(r.requestedBy) : null),
      agentRun: (r: InsightsReportDto, _: unknown, ctx: Ctx) => (r.agentRunId ? service.agentRun(ctx, r.agentRunId) : null),
      markdown: (r: InsightsReportDto) => r.markdown ?? null,
      dataset: (r: InsightsReportDto) => r.dataset ?? null,
      chart: (r: InsightsReportDto) => r.chart ?? null,
      audioUrl: (r: InsightsReportDto) => r.audioUrl ?? null,
      audioDurationSeconds: (r: InsightsReportDto) => r.audioDurationSeconds ?? null,
      failureReason: (r: InsightsReportDto) => r.failureReason ?? null,
    },
    Alert: {
      details: (a: InsightsAlertDto) => a.details ?? null,
      resource: (a: InsightsAlertDto) => a.resource ?? null,
      occurrences: (a: InsightsAlertDto) => a.occurrences ?? 1,
      agentRun: (a: InsightsAlertDto, _: unknown, ctx: Ctx) => (a.agentRunId ? service.agentRun(ctx, a.agentRunId) : null),
      acknowledgedBy: (a: InsightsAlertDto, _: unknown, ctx: Ctx) => (a.acknowledgedBy && UUID.test(a.acknowledgedBy) ? ctx.loaders.users.load(a.acknowledgedBy) : null),
    },
    AgentRun: {
      model: (r: InsightsAgentRunDto) => r.model ?? null,
      tokens: (r: InsightsAgentRunDto) => r.tokens ?? null,
      steps: async (r: InsightsAgentRunDto, _: unknown, ctx: Ctx) => r.steps ?? (await service.agentRun(ctx, r.id))?.steps ?? [],
      report: (r: InsightsAgentRunDto, _: unknown, ctx: Ctx) => (r.reportId ? service.report(ctx, r.reportId) : null),
      alerts: (r: InsightsAgentRunDto, _: unknown, ctx: Ctx) => service.alertsOfRun(ctx, r.alertIds ?? []),
    },
  };
}
