import type { ServiceHttp } from '../common/http-client';
import type { CallContext, InsightsAgentRunDto, InsightsAlertDto, InsightsReportDto, InsightsReportEngineDto, Page } from './types';

const opts = (ctx: CallContext) => ({ actorId: ctx.actorId, locale: ctx.locale, correlationId: ctx.correlationId });

/**
 * insights-service. Lists and reads that exist as `/internal/v1` use the service token; the rest of the admin API
 * (`alerts`, `ack`, `getAgentRun`, `requestReport`) is only public, so it carries the ADMIN's own token.
 */
export class InsightsClient {
  constructor(private readonly http: ServiceHttp) {}

  listReports(ctx: CallContext, q: { status?: string; cursor?: string; limit?: number }) {
    return this.http.request<Page<InsightsReportDto>>('GET', '/internal/v1/reports', { ...opts(ctx), query: { ...q, limit: q.limit ?? 20 } });
  }

  getReport(ctx: CallContext, id: string) {
    return this.http.request<InsightsReportDto>('GET', `/internal/v1/reports/${id}`, opts(ctx));
  }

  listAgentRuns(ctx: CallContext, q: { agent?: string; cursor?: string; limit?: number }) {
    return this.http.request<Page<InsightsAgentRunDto>>('GET', '/internal/v1/agent-runs', { ...opts(ctx), query: { ...q, limit: q.limit ?? 20 } });
  }

  /** Public `getAgentRun` (steps included) with the caller's token. */
  getAgentRun(ctx: CallContext, id: string, bearer: string) {
    return this.http.request<InsightsAgentRunDto>('GET', `/api/v1/insights/agent-runs/${id}`, { ...opts(ctx), bearer });
  }

  runMonitoringNow(ctx: CallContext, requestedBy: string, idempotencyKey: string) {
    return this.http.request<{ agentRunId: string; status: string }>('POST', '/internal/v1/agents/monitoring/runs', { ...opts(ctx), body: { requestedBy }, idempotencyKey });
  }

  /** Public `requestReport` as the ADMIN (so `requestedBy` is the user and `locale` defaults to theirs). */
  requestReport(ctx: CallContext, bearer: string, body: { question: string; locale?: string; engine?: string }, idempotencyKey: string) {
    return this.http.request<{ reportId: string; agentRunId: string; status: string; locale: string }>('POST', '/api/v1/insights/reports', { ...opts(ctx), bearer, body, idempotencyKey });
  }

  /** Public `listReportEngines` (ADMIN): engines with availability, never keys. */
  listReportEngines(ctx: CallContext, bearer: string) {
    return this.http.request<{ items: InsightsReportEngineDto[] }>('GET', '/api/v1/insights/reports/engines', { ...opts(ctx), bearer });
  }

  getReportAsUser(ctx: CallContext, id: string, bearer: string) {
    return this.http.request<InsightsReportDto>('GET', `/api/v1/insights/reports/${id}`, { ...opts(ctx), bearer });
  }

  listAlerts(ctx: CallContext, bearer: string, q: { status?: string; severity?: string; limit?: number }) {
    return this.http.request<Page<InsightsAlertDto>>('GET', '/api/v1/insights/alerts', { ...opts(ctx), bearer, query: { ...q, limit: q.limit ?? 50 } });
  }

  acknowledgeAlert(ctx: CallContext, bearer: string, id: string) {
    return this.http.request<InsightsAlertDto>('POST', `/api/v1/insights/alerts/${id}/ack`, { ...opts(ctx), bearer, body: {} });
  }
}
