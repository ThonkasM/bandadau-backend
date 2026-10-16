import type { AuthPrincipal } from '@bandada/auth-ts';
import { CurrentUser, Internal, Roles } from '@bandada/auth-ts/nest';
import { Idempotent } from '@bandada/idempotency-ts/nest';
import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';

import { ALERT_KINDS, ALERT_SEVERITIES, ALERT_SOURCES, ALERT_STATUSES, type AlertKind, type AlertSeverity, type AlertSource, type AlertStatus } from '../../../entities/alert';
import { AgentRunNotFoundError, DomainError, ReportNotFoundError } from '../../../entities/errors/domain-errors';
import { isLocale, type Locale } from '../../../entities/locale';
import { REPORT_STATUSES, type ReportStatus } from '../../../entities/report';
import { isReportEngine } from '../../../entities/report-engine';
import { GetPlatformKpisUseCase } from '../../../use-cases/metrics/metrics';
import { AcknowledgeAlertUseCase, ListAlertsUseCase, RaiseAlertUseCase } from '../../../use-cases/monitoring/alerts';
import { RunMonitoringUseCase } from '../../../use-cases/monitoring/run-monitoring';
import { PLATFORM_DATA, type PlatformDataPort } from '../../../use-cases/ports/platform-data.port';
import { AGENT_RUN_REPOSITORY, type AgentRunRepository } from '../../../use-cases/ports/repositories';
import { GetReportUseCase, ListReportsUseCase } from '../../../use-cases/reports/get-report';
import { ListReportEnginesUseCase } from '../../../use-cases/reports/list-report-engines';
import { RequestReportUseCase } from '../../../use-cases/reports/request-report';
import { toAgentRunDto, toAgentRunSummaryDto, toAlertDto, toReportDto, toReportSummaryDto } from '../../presenters/dto';
import { localeOf, type RequestLike, toHttpProblem, validationProblem } from './http-problem';

type FieldError = { field: string; code: string; message: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function limitOf(raw: string | undefined, errors: FieldError[]): number {
  if (raw === undefined) return 20;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 50) errors.push({ field: 'limit', code: 'OUT_OF_RANGE', message: 'limit must be between 1 and 50' });
  return n;
}
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[], field: string, errors: FieldError[]): T | undefined => {
  if (v === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(v)) errors.push({ field, code: 'INVALID_VALUE', message: `${field} must be one of ${allowed.join(', ')}` });
  return v as T;
};

function parseReportRequest(body: unknown, req: RequestLike): { question: string; locale?: string; engine?: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const errors: FieldError[] = [];
  for (const k of Object.keys(b)) if (k !== 'question' && k !== 'locale' && k !== 'engine') errors.push({ field: `/${k}`, code: 'UNKNOWN_FIELD', message: `unexpected field ${k}` });
  if (typeof b.question !== 'string') errors.push({ field: '/question', code: 'REQUIRED', message: 'question is required' });
  else if (b.question.trim().length < 10 || b.question.length > 1000) errors.push({ field: '/question', code: 'OUT_OF_RANGE', message: 'question must have between 10 and 1000 characters' });
  if (b.locale !== undefined && !isLocale(b.locale)) errors.push({ field: '/locale', code: 'INVALID_VALUE', message: 'locale must be es or en' });
  if (b.engine !== undefined && !isReportEngine(b.engine)) errors.push({ field: '/engine', code: 'INVALID_VALUE', message: 'engine must be AUTO, OPENCODE, OLLAMA or STUB' });
  if (errors.length > 0) throw validationProblem(req, errors);
  return { question: b.question as string, locale: b.locale as string | undefined, engine: b.engine as string | undefined };
}

const accepted = (res: Response, r: { reportId: string; agentRunId: string; status: string; locale: Locale }, base: string) => {
  res.setHeader('Location', `${base}/${r.reportId}`);
  res.setHeader('Content-Language', r.locale);
  return { reportId: r.reportId, agentRunId: r.agentRunId, status: r.status, locale: r.locale };
};

/** Public API (`/api/v1/insights`): ADMIN only. */
@Controller('api/v1/insights')
export class InsightsController {
  constructor(
    @Inject(RequestReportUseCase) private readonly requestReport: RequestReportUseCase,
    @Inject(GetReportUseCase) private readonly getReport: GetReportUseCase,
    @Inject(ListReportEnginesUseCase) private readonly listEngines: ListReportEnginesUseCase,
    @Inject(ListAlertsUseCase) private readonly listAlerts: ListAlertsUseCase,
    @Inject(AcknowledgeAlertUseCase) private readonly ack: AcknowledgeAlertUseCase,
    @Inject(AGENT_RUN_REPOSITORY) private readonly runs: AgentRunRepository,
  ) {}

  @Post('reports')
  @HttpCode(202)
  @Roles('ADMIN')
  @Idempotent()
  async requestReportEndpoint(@Body() body: unknown, @CurrentUser() user: AuthPrincipal, @Req() req: RequestLike, @Res({ passthrough: true }) res: Response) {
    const input = parseReportRequest(body, req);
    try {
      const r = await this.requestReport.execute({ question: input.question, locale: input.locale ?? user.locale, engine: input.engine, requestedBy: user.sub, defaultLocale: localeOf(req) });
      return accepted(res, r, '/api/v1/insights/reports');
    } catch (error) {
      throw toHttpProblem(error, req);
    }
  }

  @Get('reports/engines')
  @Roles('ADMIN')
  async listReportEngines(@Req() req: RequestLike) {
    try {
      return { items: await this.listEngines.execute() };
    } catch (error) {
      throw toHttpProblem(error, req);
    }
  }

  @Get('reports/:reportId')
  @Roles('ADMIN')
  async getReportEndpoint(@Param('reportId') reportId: string, @Req() req: RequestLike, @Res({ passthrough: true }) res: Response) {
    try {
      if (!UUID.test(reportId)) throw new ReportNotFoundError();
      const { report, audioUrl } = await this.getReport.execute(reportId);
      res.setHeader('Content-Language', report.locale);
      return toReportDto(report, audioUrl);
    } catch (error) {
      throw toHttpProblem(error, req);
    }
  }

  @Get('alerts')
  @Roles('ADMIN')
  async listAlertsEndpoint(@Req() req: RequestLike, @Query('status') status?: string, @Query('severity') severity?: string, @Query('cursor') cursor?: string, @Query('limit') limitRaw?: string) {
    const errors: FieldError[] = [];
    const st = oneOf<AlertStatus>(status, ALERT_STATUSES, 'status', errors);
    const sv = oneOf<AlertSeverity>(severity, ALERT_SEVERITIES, 'severity', errors);
    const limit = limitOf(limitRaw, errors);
    if (errors.length > 0) throw validationProblem(req, errors);
    try {
      const page = await this.listAlerts.execute({ status: st, severity: sv, cursor, limit });
      return { items: page.items.map(toAlertDto), nextCursor: page.nextCursor };
    } catch (error) {
      throw toHttpProblem(error, req);
    }
  }

  @Post('alerts/:alertId/ack')
  @HttpCode(200)
  @Roles('ADMIN')
  async acknowledge(@Param('alertId') alertId: string, @Body() body: unknown, @CurrentUser() user: AuthPrincipal, @Req() req: RequestLike) {
    const b = (body ?? {}) as Record<string, unknown>;
    const errors: FieldError[] = [];
    for (const k of Object.keys(b)) if (k !== 'note') errors.push({ field: `/${k}`, code: 'UNKNOWN_FIELD', message: `unexpected field ${k}` });
    if (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > 500)) errors.push({ field: '/note', code: 'OUT_OF_RANGE', message: 'note must be a string of at most 500 characters' });
    if (errors.length > 0) throw validationProblem(req, errors);
    try {
      return toAlertDto(await this.ack.execute({ alertId, by: user.sub, note: b.note as string | undefined }));
    } catch (error) {
      throw toHttpProblem(error, req);
    }
  }

  @Get('agent-runs/:agentRunId')
  @Roles('ADMIN')
  async getAgentRun(@Param('agentRunId') id: string, @Req() req: RequestLike) {
    try {
      const found = await this.runs.findById(id);
      if (!found) throw new AgentRunNotFoundError();
      return toAgentRunDto(found.run, found.steps);
    } catch (error) {
      throw toHttpProblem(error, req);
    }
  }
}

/** Service-to-service API (`/internal/v1`): blocked at Traefik, service token required. */
@Controller('internal/v1')
export class InternalController {
  constructor(
    @Inject(RequestReportUseCase) private readonly requestReport: RequestReportUseCase,
    @Inject(GetReportUseCase) private readonly getReport: GetReportUseCase,
    @Inject(ListReportsUseCase) private readonly listReports: ListReportsUseCase,
    @Inject(RaiseAlertUseCase) private readonly raise: RaiseAlertUseCase,
    @Inject(RunMonitoringUseCase) private readonly monitoring: RunMonitoringUseCase,
    @Inject(GetPlatformKpisUseCase) private readonly kpis: GetPlatformKpisUseCase,
    @Inject(PLATFORM_DATA) private readonly data: PlatformDataPort,
    @Inject(AGENT_RUN_REPOSITORY) private readonly runs: AgentRunRepository,
  ) {}

  private actorOf(req: RequestLike & { user?: AuthPrincipal }): string {
    const h = req.headers['x-actor-id'];
    const actor = Array.isArray(h) ? h[0] : h;
    return actor && UUID.test(actor) ? actor : `system:${req.user?.sub ?? 'service'}`;
  }

  @Get('reports')
  @Internal('internal:read')
  async listReportsEndpoint(@Req() req: RequestLike, @Query('status') status?: string, @Query('cursor') cursor?: string, @Query('limit') limitRaw?: string) {
    const errors: FieldError[] = [];
    const st = oneOf<ReportStatus>(status, REPORT_STATUSES, 'status', errors);
    const limit = limitOf(limitRaw, errors);
    if (errors.length > 0) throw validationProblem(req, errors);
    try {
      const page = await this.listReports.execute({ status: st, cursor, limit });
      return { items: page.items.map(toReportSummaryDto), nextCursor: page.nextCursor };
    } catch (error) {
      throw toHttpProblem(error, req);
    }
  }

  @Post('reports')
  @HttpCode(202)
  @Internal('internal:write')
  @Idempotent()
  async requestReportInternal(@Body() body: unknown, @Req() req: RequestLike & { user?: AuthPrincipal }, @Res({ passthrough: true }) res: Response) {
    const input = parseReportRequest(body, req);
    try {
      const r = await this.requestReport.execute({ question: input.question, locale: input.locale, engine: input.engine, requestedBy: this.actorOf(req), defaultLocale: localeOf(req) });
      return accepted(res, r, '/internal/v1/reports');
    } catch (error) {
      throw toHttpProblem(error, req);
    }
  }

  @Get('reports/:reportId')
  @Internal('internal:read')
  async getReportInternal(@Param('reportId') reportId: string, @Req() req: RequestLike, @Res({ passthrough: true }) res: Response) {
    try {
      if (!UUID.test(reportId)) throw new ReportNotFoundError();
      const { report, audioUrl } = await this.getReport.execute(reportId);
      res.setHeader('Content-Language', report.locale);
      return toReportDto(report, audioUrl);
    } catch (error) {
      throw toHttpProblem(error, req);
    }
  }

  @Get('agent-runs')
  @Internal('internal:read')
  async listAgentRuns(@Req() req: RequestLike, @Query('agent') agent?: string, @Query('cursor') cursor?: string, @Query('limit') limitRaw?: string) {
    const errors: FieldError[] = [];
    const a = oneOf(agent, ['MONITORING', 'REPORT', 'EXTERNAL_MCP'] as const, 'agent', errors);
    const limit = limitOf(limitRaw, errors);
    if (errors.length > 0) throw validationProblem(req, errors);
    try {
      const page = await this.runs.list({ agent: a, cursor, limit });
      return { items: page.items.map(toAgentRunSummaryDto), nextCursor: page.nextCursor };
    } catch (error) {
      throw toHttpProblem(error, req);
    }
  }

  @Post('agents/monitoring/runs')
  @HttpCode(202)
  @Internal('internal:write')
  @Idempotent()
  async runMonitoringNow(@Req() req: RequestLike & { user?: AuthPrincipal }, @Body() body: unknown) {
    const b = (body ?? {}) as { requestedBy?: unknown };
    if (b.requestedBy !== undefined && (typeof b.requestedBy !== 'string' || !UUID.test(b.requestedBy))) {
      throw validationProblem(req, [{ field: '/requestedBy', code: 'INVALID_FORMAT', message: 'requestedBy must be a UUID' }]);
    }
    const start = await this.monitoring.start({ trigger: 'MANUAL', requestedBy: (b.requestedBy as string | undefined) ?? this.actorOf(req) });
    if (!start) throw toHttpProblem(new DomainError('UPSTREAM_UNAVAILABLE', 'monitoring lock unavailable'), req);
    return { agentRunId: start.agentRunId, status: start.status };
  }

  @Post('alerts')
  @HttpCode(201)
  @Internal('internal:write')
  @Idempotent()
  async raiseAlert(@Body() body: unknown, @Req() req: RequestLike & { user?: AuthPrincipal }) {
    const b = (body ?? {}) as Record<string, unknown>;
    const errors: FieldError[] = [];
    for (const k of Object.keys(b)) if (!['severity', 'kind', 'message', 'details', 'source'].includes(k)) errors.push({ field: `/${k}`, code: 'UNKNOWN_FIELD', message: `unexpected field ${k}` });
    const severity = oneOf<AlertSeverity>(b.severity as string | undefined, ALERT_SEVERITIES, '/severity', errors);
    const kind = oneOf<AlertKind>(b.kind as string | undefined, ALERT_KINDS, '/kind', errors);
    const source = oneOf<AlertSource>(b.source as string | undefined, ALERT_SOURCES, '/source', errors);
    if (!severity && b.severity === undefined) errors.push({ field: '/severity', code: 'REQUIRED', message: 'severity is required' });
    if (!kind && b.kind === undefined) errors.push({ field: '/kind', code: 'REQUIRED', message: 'kind is required' });
    if (typeof b.message !== 'string' || b.message.length === 0 || b.message.length > 1000) errors.push({ field: '/message', code: 'OUT_OF_RANGE', message: 'message is required (max 1000 characters)' });
    if (b.details !== undefined && (typeof b.details !== 'object' || b.details === null || Array.isArray(b.details))) errors.push({ field: '/details', code: 'INVALID_TYPE', message: 'details must be an object' });
    if (errors.length > 0) throw validationProblem(req, errors);
    try {
      const r = await this.raise.execute({
        severity: severity as AlertSeverity,
        kind: kind as AlertKind,
        message: b.message as string,
        details: b.details as Record<string, unknown> | undefined,
        source: source ?? (req.user?.sub === 'n8n' ? 'N8N' : 'MANUAL'),
      });
      return toAlertDto(r.alert);
    } catch (error) {
      throw toHttpProblem(error, req);
    }
  }

  @Get('kpis')
  @Internal('internal:read')
  async getPlatformKpis(@Req() req: RequestLike, @Query('from') from?: string, @Query('to') to?: string) {
    if (!from || !to) throw validationProblem(req, [{ field: 'from', code: 'REQUIRED', message: 'from and to are required (YYYY-MM-DD)' }]);
    try {
      return await this.kpis.execute(from, to);
    } catch (error) {
      throw toHttpProblem(error, req);
    }
  }

  @Get('service-health')
  @Header('Cache-Control', 'no-store')
  @Internal('internal:read')
  async getServiceHealth(@Req() req: RequestLike & { user?: AuthPrincipal }) {
    try {
      return await this.data.serviceHealth({ actorId: this.actorOf(req) }, { includeQueues: true });
    } catch (error) {
      throw toHttpProblem(error, req);
    }
  }
}
