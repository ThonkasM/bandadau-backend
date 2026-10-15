import { ForbiddenError, RateLimitedError, ValidationError } from '../../../src/entities/errors/domain-errors';
import { StatAnomalyDetector } from '../../../src/interface-adapters/gateways/anomaly/stat-anomaly.detector';
import { McpToolService, type ToolContext } from '../../../src/use-cases/mcp-tools/mcp-tools';
import { validatePromql } from '../../../src/use-cases/mcp-tools/promql';
import { RateLimiter } from '../../../src/use-cases/mcp-tools/rate-limiter';
import { activeActor, DetectAnomaliesUseCase, GetPlatformKpisUseCase, projectDomainEvent, validateRange } from '../../../src/use-cases/metrics/metrics';
import { RaiseAlertUseCase } from '../../../src/use-cases/monitoring/alerts';
import type { PlatformDataPort } from '../../../src/use-cases/ports/platform-data.port';
import { ReportFinalizer } from '../../../src/use-cases/reports/report-finalizer';
import { SaveExternalReportUseCase } from '../../../src/use-cases/reports/save-external-report';
import { FakeClock, FakeTts, InlineJobs, MemAlerts, MemMetrics, MemReports, MemStorage, SeqIds, silentLogger } from '../../support/fakes';

describe('event -> metric ACL', () => {
  const t = '2026-10-15T12:00:00Z';
  it('maps domain events to daily counters', () => {
    expect(projectDomainEvent('bandada.identity.user.registered.v1', {}, t)).toEqual([{ name: 'newUsers', date: '2026-10-15', amount: 1 }]);
    expect(projectDomainEvent('bandada.events.registration.failed.v1', {}, t)).toEqual([{ name: 'registrationsFailed', date: '2026-10-15', amount: 1 }]);
    expect(projectDomainEvent('bandada.wallet.credits-debited.v1', { amountCredits: 20 }, t)).toEqual([{ name: 'creditsSpent', date: '2026-10-15', amount: 20 }]);
    expect(projectDomainEvent('bandada.wallet.credits-refunded.v1', { amountCredits: 20 }, t).map((d) => d.name)).toEqual(['creditsRefunded', 'sagaCompensations']);
    expect(projectDomainEvent('bandada.insights.alert.raised.v1', {}, t)).toEqual([]);
    expect(projectDomainEvent('bandada.something.new.v1', {}, t)).toEqual([]);
  });
  it('counts active users from activity events only', () => {
    expect(activeActor('bandada.social.post.created.v1', { authorId: 'u1' })).toBe('u1');
    expect(activeActor('bandada.wallet.topup.paid.v1', { userId: 'u2' })).toBe('u2');
    expect(activeActor('bandada.identity.user.registered.v1', { userId: 'u3' })).toBeNull();
  });
});

describe('KPIs and anomalies', () => {
  it('sums the range, zero-fills the series and counts open alerts', async () => {
    const metrics = new MemMetrics();
    metrics.set('posts', '2026-10-01', 3);
    metrics.set('posts', '2026-10-03', 4);
    metrics.set('activeUsers', '2026-10-01', 5);
    metrics.set('activeUsers', '2026-10-03', 9);
    const kpis = await new GetPlatformKpisUseCase(metrics, new MemAlerts()).execute('2026-10-01', '2026-10-03');
    expect(kpis).toMatchObject({ posts: 7, activeUsers: 9, openAlerts: 0 });
    expect(kpis.series.map((s) => s.posts)).toEqual([3, 0, 4]);
  });
  it('validates ranges (format, order, 366 days)', () => {
    expect(() => validateRange('2026-10-02', '2026-10-01')).toThrow(ValidationError);
    expect(() => validateRange('2026/10/01', '2026-10-01')).toThrow(ValidationError);
    expect(() => validateRange('2025-01-01', '2026-10-01')).toThrow(/366/);
    expect(() => validateRange('2025-10-15', '2026-10-15')).not.toThrow();
  });
  it('detects anomalies per metric through the AnomalyDetector port', async () => {
    const metrics = new MemMetrics();
    [10, 11, 9, 10, 12, 10, 95, 11].forEach((v, i) => metrics.set('posts', `2026-10-0${i + 1}`, v));
    const out = await new DetectAnomaliesUseCase(metrics, new StatAnomalyDetector()).execute({ metrics: ['posts', 'comments'], from: '2026-10-01', to: '2026-10-08', sensitivity: 0.8 });
    expect(out.modelVersion).toBe('stat-robust-zscore-1.0.0');
    expect(out.anomalies).toEqual([expect.objectContaining({ metric: 'posts', at: '2026-10-07', direction: 'SPIKE' })]);
  });
});

describe('PromQL guard for query_metrics', () => {
  it.each([
    'histogram_quantile(0.95, sum by (le, service_name) (rate(http_server_request_duration_seconds_bucket[5m])))',
    'sum(rate(saga_compensations_total[15m])) / sum(rate(saga_duration_seconds_count[15m]))',
    'dlq_depth{queue="x.dlq"}',
  ])('accepts %s', (q) => expect(() => validatePromql(q)).not.toThrow());
  it.each([
    ['up', /not in the allowlist/],
    ['process_cpu_seconds_total', /not in the allowlist/],
    ['{__name__=~".+"}', /__name__/],
    ['sum(rate(dlq_depth[5m])) + node_load1', /node_load1/],
    ['max_over_time(rate(saga_duration_seconds_count[5m])[2d:1m])', /24 h/],
    ['1 + 1', /at least one/],
  ])('rejects %s', (q, why) => expect(() => validatePromql(q)).toThrow(why));
});

describe('RateLimiter', () => {
  it('allows N per window and tells when to retry', () => {
    const clock = new FakeClock();
    const rl = new RateLimiter(clock, 3, 60_000);
    for (let i = 0; i < 3; i++) rl.consume('u');
    expect(() => rl.consume('u')).toThrow(RateLimitedError);
    expect(() => rl.consume('other')).not.toThrow();
    clock.advance(61_000);
    expect(() => rl.consume('u')).not.toThrow();
  });
});

describe('McpToolService', () => {
  const data = (over: Partial<PlatformDataPort> = {}): PlatformDataPort =>
    ({
      registrationStats: async (_c, q) => ({ ...q, rows: [], totals: { confirmed: 1, failed: 0, cancelled: 0, pending: 0 } }),
      serviceHealth: async () => ({ checkedAt: 'x', overall: 'UP', queues: [], services: [{ name: 'a', status: 'UP', latencyMs: 3, checks: { dynamodb: 'UP' } }] }),
      ...over,
    }) as PlatformDataPort;
  const build = (d = data()) => {
    const clock = new FakeClock();
    const alerts = new MemAlerts();
    const reports = new MemReports();
    const jobs = new InlineJobs();
    const metrics = new MemMetrics();
    const finalizer = new ReportFinalizer(reports, new FakeTts(true), new MemStorage(), clock, silentLogger);
    const svc = new McpToolService(d, new GetPlatformKpisUseCase(metrics, alerts), new DetectAnomaliesUseCase(metrics, new StatAnomalyDetector()), new RaiseAlertUseCase(alerts, clock, new SeqIds()), new SaveExternalReportUseCase(reports, finalizer, new FakeTts(true), clock, new SeqIds(), jobs, 'es', 'http://api.test'));
    return { svc, alerts, reports, jobs };
  };
  const admin: ToolContext = { principal: { sub: 'u-admin', type: 'user', roles: ['ADMIN'], scopes: [] } };
  const service: ToolContext = { principal: { sub: 'insights-service', type: 'service', roles: [], scopes: ['internal:read'] }, agentRunId: 'run-1' };

  it('raise_alert is for services only (defense in depth, even if the name is known)', async () => {
    const { svc } = build();
    const args = { severity: 'WARNING', kind: 'SERVICE_DOWN', message: 'x', dedupeKey: 'SERVICE_DOWN:a' };
    await expect(svc.call('raise_alert', args, admin)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.call('raise_alert', args, service)).resolves.toMatchObject({ created: true, status: 'OPEN' });
    await expect(svc.call('raise_alert', args, service)).resolves.toMatchObject({ created: false });
  });
  it('get_service_health drops per-check detail to match the contract', async () => {
    const out = (await build().svc.call('get_service_health', {}, admin)) as { services: Record<string, unknown>[] };
    expect(Object.keys(out.services[0]!).sort()).toEqual(['error', 'latencyMs', 'name', 'status']);
  });
  it('validates ranges and the promql allowlist before calling upstream', async () => {
    const { svc } = build();
    await expect(svc.call('get_registration_stats', { from: '2026-10-05', to: '2026-10-01' }, admin)).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.call('query_metrics', { query: 'up' }, admin)).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.call('get_registration_stats', { from: '2026-10-01', to: '2026-10-05' }, admin)).resolves.toMatchObject({ groupBy: 'day' });
  });
  it('unknown tools are TOOL_NOT_FOUND', async () => {
    await expect(build().svc.call('drop_database', {}, admin)).rejects.toMatchObject({ code: 'TOOL_NOT_FOUND' });
  });
  it('generate_report persists a RUNNING report for the caller and finishes it in the background', async () => {
    const { svc, reports, jobs } = build();
    const out = (await svc.call('generate_report', { title: 'Reporte de prueba', markdown: '## Hola\n\n3 inscripciones', dataset: { columns: [{ name: 'a', type: 'integer' }], rows: [[3]] }, chart: { mark: 'bar', encoding: { color: '#ff0000' }, data: { url: 'http://x' } }, audioSummary: 'Tres inscripciones.', locale: 'en' }, { ...admin, agentRunId: 'audit-1' })) as { reportId: string; status: string; audioStatus: string };
    expect([out.status, out.audioStatus]).toEqual(['RUNNING', 'PENDING']);
    await jobs.drain();
    const r = (await reports.findById(out.reportId))!;
    expect(r).toMatchObject({ status: 'READY', locale: 'en', requestedBy: 'u-admin', agentRunId: 'audit-1', audioKey: `reports/${out.reportId}/summary.en.mp3` });
    expect(JSON.stringify(r.chart)).not.toContain('#ff0000');
    expect(r.chart).toMatchObject({ data: { name: 'dataset' } });
  });
});
