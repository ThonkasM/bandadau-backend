import { DomainError, ForbiddenError, ValidationError } from '../../entities/errors/domain-errors';
import { METRIC_NAMES, type MetricName } from '../../entities/metric-point';
import { type DetectAnomaliesUseCase, type GetPlatformKpisUseCase, validateRange } from '../metrics/metrics';
import type { RaiseAlertUseCase } from '../monitoring/alerts';
import type { CallCtx, PlatformDataPort } from '../ports/platform-data.port';
import type { SaveExternalReportUseCase } from '../reports/save-external-report';
import { validatePromql } from './promql';

export interface ToolPrincipal {
  sub: string;
  type: 'user' | 'service';
  roles: string[];
  scopes: string[];
}
export interface ToolContext {
  principal: ToolPrincipal;
  correlationId?: string;
  /** Run that audits this call: the agent's own run (service) or the per-call EXTERNAL_MCP run. */
  agentRunId?: string | null;
  /** Human on whose behalf an internal agent acts. */
  actorId?: string;
}

type Args = Record<string, unknown>;
export type ToolHandler = (args: Args, ctx: ToolContext) => Promise<unknown>;

const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);

export const isServicePrincipal = (p: ToolPrincipal) => p.type === 'service';

/** Use cases behind the 14 MCP tools of `bandadau-docs/contracts/mcp/tools.md`. Handlers return structured output (contract `outputSchema`). */
export class McpToolService {
  readonly handlers: Record<string, ToolHandler>;

  constructor(
    private readonly data: PlatformDataPort,
    private readonly kpis: GetPlatformKpisUseCase,
    private readonly anomalies: DetectAnomaliesUseCase,
    private readonly raiseAlert: RaiseAlertUseCase,
    private readonly saveReport: SaveExternalReportUseCase,
  ) {
    const call = (ctx: ToolContext): CallCtx => ({
      actorId: ctx.principal.type === 'user' ? ctx.principal.sub : (ctx.actorId ?? ctx.principal.sub),
      correlationId: ctx.correlationId,
    });
    this.handlers = {
      get_platform_kpis: (a) => this.kpis.execute(str(a.from, ''), str(a.to, '')),
      get_registration_stats: (a, c) => {
        validateRange(str(a.from, ''), str(a.to, ''));
        return this.data.registrationStats(call(c), {
          from: str(a.from, ''),
          to: str(a.to, ''),
          groupBy: str(a.groupBy, 'day') as 'day' | 'event' | 'status',
          eventId: typeof a.eventId === 'string' ? a.eventId : undefined,
        });
      },
      list_events: (a, c) =>
        this.data.listEvents(call(c), { from: str(a.from, ''), to: str(a.to, ''), status: typeof a.status === 'string' ? a.status : undefined, limit: num(a.limit, 50) }),
      get_credit_stats: (a, c) => {
        validateRange(str(a.from, ''), str(a.to, ''));
        return this.data.creditStats(call(c), { from: str(a.from, ''), to: str(a.to, ''), groupBy: str(a.groupBy, 'day') as 'day' | 'week' | 'month' });
      },
      list_recent_registrations: (a, c) => {
        const from = typeof a.from === 'string' ? a.from : undefined;
        const to = typeof a.to === 'string' ? a.to : undefined;
        if (from && to) validateRange(from, to);
        return this.data.listRecentRegistrations(call(c), {
          from,
          to,
          status: str(a.status, 'CONFIRMED'),
          eventId: typeof a.eventId === 'string' ? a.eventId : undefined,
          limit: Math.min(50, Math.max(1, num(a.limit, 10))),
        });
      },
      get_top_credit_spenders: (a, c) => {
        validateRange(str(a.from, ''), str(a.to, ''));
        return this.data.topCreditSpenders(call(c), { from: str(a.from, ''), to: str(a.to, ''), limit: Math.min(20, Math.max(1, num(a.limit, 5))) });
      },
      get_content_stats: (a, c) => {
        validateRange(str(a.from, ''), str(a.to, ''));
        return this.data.contentStats(call(c), { from: str(a.from, ''), to: str(a.to, ''), topHashtags: num(a.topHashtags, 10) });
      },
      list_flagged_content: (a, c) => this.data.flaggedContent(call(c), { source: str(a.source, 'ALL') as 'AI' | 'REPORTS' | 'ALL', limit: num(a.limit, 50) }),
      list_failed_sagas: (a, c) =>
        this.data.failedSagas(call(c), {
          status: typeof a.status === 'string' ? (a.status as 'FAILED' | 'COMPENSATED') : undefined,
          since: typeof a.since === 'string' ? a.since : new Date(Date.now() - 86_400_000).toISOString(),
          limit: num(a.limit, 50),
        }),
      get_service_health: async (a, c) => {
        const h = await this.data.serviceHealth(call(c), { includeQueues: a.includeQueues !== false });
        // contract output: services carry { name, status, latencyMs, error } only (per-check detail stays in the REST view)
        return { ...h, services: h.services.map(({ name, status, latencyMs, error }) => ({ name, status, latencyMs: latencyMs ?? null, error: error ?? null })) };
      },
      query_metrics: (a, c) => {
        validatePromql(str(a.query, ''));
        if (typeof a.start === 'string' && typeof a.end === 'string') {
          const span = Date.parse(a.end) - Date.parse(a.start);
          if (!(span >= 0) || span > 7 * 86_400_000) throw new ValidationError('end must be after start and within 7 days');
        }
        return this.data.queryMetrics(call(c), { query: str(a.query, ''), start: a.start as string | undefined, end: a.end as string | undefined, step: str(a.step, '60s') });
      },
      detect_anomalies: (a) => {
        const metrics = (Array.isArray(a.metrics) ? a.metrics : []).filter((m): m is MetricName => (METRIC_NAMES as readonly string[]).includes(m as string));
        if (metrics.length === 0) throw new ValidationError('metrics must contain at least one known metric');
        if (a.granularity === 'hour') throw new ValidationError('hourly granularity is not available: only daily series are projected');
        return this.anomalies.execute({ metrics, from: str(a.from, ''), to: str(a.to, ''), sensitivity: num(a.sensitivity, 0.8) });
      },
      generate_report: (a, c) => {
        const requestedBy = c.principal.type === 'user' ? c.principal.sub : `system:${c.principal.sub}`;
        return this.saveReport.execute(
          {
            title: str(a.title, ''),
            question: typeof a.question === 'string' ? a.question : undefined,
            markdown: str(a.markdown, ''),
            dataset: a.dataset as never,
            chart: a.chart as Record<string, unknown> | undefined,
            audioSummary: typeof a.audioSummary === 'string' ? a.audioSummary : undefined,
            locale: typeof a.locale === 'string' ? a.locale : undefined,
          },
          requestedBy,
          c.agentRunId ?? null,
        );
      },
      raise_alert: async (a, c) => {
        if (!isServicePrincipal(c.principal)) throw new ForbiddenError('raise_alert is only available to internal agents');
        const r = await this.raiseAlert.execute({
          severity: a.severity as never,
          kind: a.kind as never,
          message: str(a.message, ''),
          details: (a.details as Record<string, unknown> | undefined) ?? {},
          dedupeKey: str(a.dedupeKey, ''),
          source: 'MONITORING_AGENT',
          agentRunId: c.agentRunId ?? null,
          correlationId: c.correlationId,
        });
        return { alertId: r.alert.id, created: r.created, status: r.alert.status };
      },
    };
  }

  /** Runs a tool; unknown names are a caller error. Domain errors propagate for the adapter to render as `isError`. */
  async call(name: string, args: Args, ctx: ToolContext): Promise<unknown> {
    const handler = this.handlers[name];
    if (!handler) throw new DomainError('TOOL_NOT_FOUND', `Unknown tool ${name}`);
    return handler(args, ctx);
  }
}
