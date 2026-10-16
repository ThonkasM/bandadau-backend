import { randomUUID } from 'node:crypto';

import { forbidden, toUserErrors } from '../../common/errors';
import { clampFirst, connectionFromPage } from '../../common/relay';
import type { DataSources } from '../../data-sources/data-sources';
import type { InsightsAgentRunDto, InsightsAlertDto, InsightsReportDto } from '../../data-sources/types';
import type { GatewayContext } from '../../graphql/context';

type Ctx = GatewayContext;

const bearer = (ctx: Ctx): string => {
  if (!ctx.bearer) throw forbidden();
  return ctx.bearer;
};
const notFound = (e: unknown) => {
  if (e && typeof e === 'object' && (e as { status?: number }).status === 404) return null;
  throw e;
};

/** Insights fields of the admin GraphQL API (phase 2): REST calls to insights-service, no business logic here. */
export class InsightsService {
  constructor(private readonly ds: DataSources) {}

  async reports(ctx: Ctx, args: { after?: string | null; first?: number | null; status?: string | null }) {
    const page = await this.ds.insights.listReports(ctx.call, { status: args.status ?? undefined, cursor: args.after ?? undefined, limit: clampFirst(args.first, 50, 20) });
    return connectionFromPage(page.items, page.nextCursor, args.after);
  }

  report(ctx: Ctx, id: string): Promise<InsightsReportDto | null> {
    return this.ds.insights.getReport(ctx.call, id).catch(notFound);
  }

  async alerts(ctx: Ctx, args: { status?: string | null; severity?: string | null; first?: number | null }): Promise<InsightsAlertDto[]> {
    const page = await this.ds.insights.listAlerts(ctx.call, bearer(ctx), { status: args.status ?? undefined, severity: args.severity ?? undefined, limit: clampFirst(args.first, 50, 50) });
    return page.items;
  }

  async agentRuns(ctx: Ctx, args: { after?: string | null; first?: number | null; agent?: string | null }) {
    const page = await this.ds.insights.listAgentRuns(ctx.call, { agent: args.agent ?? undefined, cursor: args.after ?? undefined, limit: clampFirst(args.first, 50, 20) });
    return connectionFromPage(page.items, page.nextCursor, args.after);
  }

  agentRun(ctx: Ctx, id: string): Promise<InsightsAgentRunDto | null> {
    return this.ds.insights.getAgentRun(ctx.call, id, bearer(ctx)).catch(notFound);
  }

  async reportEngines(ctx: Ctx) {
    return (await this.ds.insights.listReportEngines(ctx.call, bearer(ctx))).items;
  }

  async requestReport(ctx: Ctx, args: { question: string; locale?: string | null; engine?: string | null }) {
    try {
      const accepted = await this.ds.insights.requestReport(ctx.call, bearer(ctx), { question: args.question, ...(args.locale ? { locale: args.locale } : {}), ...(args.engine && args.engine !== 'AUTO' ? { engine: args.engine } : {}) }, randomUUID());
      return { report: await this.ds.insights.getReportAsUser(ctx.call, accepted.reportId, bearer(ctx)), errors: [] };
    } catch (e) {
      return { report: null, errors: toUserErrors(e) };
    }
  }

  async acknowledgeAlert(ctx: Ctx, id: string) {
    try {
      return { alert: await this.ds.insights.acknowledgeAlert(ctx.call, bearer(ctx), id), errors: [] };
    } catch (e) {
      return { alert: null, errors: toUserErrors(e) };
    }
  }

  async runMonitoringNow(ctx: Ctx) {
    try {
      const started = await this.ds.insights.runMonitoringNow(ctx.call, ctx.principal?.sub ?? '', randomUUID());
      return { agentRun: await this.agentRun(ctx, started.agentRunId), errors: [] };
    } catch (e) {
      return { agentRun: null, errors: toUserErrors(e) };
    }
  }

  /** Alerts raised by one run (insights has no get-alert-by-id: the newest 50 are filtered). */
  async alertsOfRun(ctx: Ctx, ids: string[]): Promise<InsightsAlertDto[]> {
    if (ids.length === 0) return [];
    const wanted = new Set(ids);
    return (await this.alerts(ctx, { first: 50 })).filter((a) => wanted.has(a.id));
  }
}
