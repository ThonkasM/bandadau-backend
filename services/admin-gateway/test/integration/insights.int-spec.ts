import { type Harness, ids, startHarness, user } from './support/harness';

let h: Harness;
let admin: string;
let moderator: string;

const U = (n: number) => `0192a3b4-0000-7000-8000-0000000009${String(n).padStart(2, '0')}`;
const report = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: 'Inscripciones', question: '¿Cuántas inscripciones?', locale: 'es', status: 'READY', requestedBy: ids.admin, agentRunId: U(50), hasAudio: true,
  createdAt: '2026-10-14T15:04:05Z', completedAt: '2026-10-14T15:04:52Z', ...over,
});
const alert = (id: string, over: Record<string, unknown> = {}) => ({
  id, severity: 'WARNING', kind: 'SERVICE_DOWN', message: 'wallet-service no responde', details: { service: 'wallet-service' }, status: 'OPEN', source: 'MONITORING_AGENT',
  agentRunId: U(50), raisedAt: '2026-10-14T15:00:12Z', acknowledgedAt: null, acknowledgedBy: null, resource: 'wallet-service', occurrences: 2, ...over,
});
const run = (over: Record<string, unknown> = {}) => ({
  id: U(50), agent: 'MONITORING', trigger: 'MANUAL', status: 'SUCCEEDED', model: null, toolsUsed: ['get_service_health'], tokens: { input: 0, output: 0, total: 0 },
  reportId: null, alertIds: [U(31)], error: null, stopReason: 'COMPLETED', startedAt: '2026-10-14T15:00:00Z', finishedAt: '2026-10-14T15:00:05Z', ...over,
});
const code = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) => res.body.errors?.[0]?.extensions?.code;

beforeAll(async () => {
  h = await startHarness();
  admin = await h.token(ids.admin, ['ADMIN']);
  moderator = await h.token(ids.moderator, ['MODERATOR']);
});
afterAll(async () => {
  await h?.close();
});
beforeEach(() => h.resetMocks());

describe('insights queries (phase 2)', () => {
  it('reports: service-token list with Relay pagination, requestedBy resolved for users and null for system requesters', async () => {
    h.mock('GET', '/insights/internal/v1/reports', () => ({ body: { items: [report(U(1)), report(U(2), { requestedBy: 'system:n8n', title: null })], nextCursor: 'C2' } }));
    h.mock('GET', '/identity/internal/v1/users', (c) => ({ body: { items: (c.query.get('ids') ?? '').split(',').filter(Boolean).map((id) => user(id, { roles: ['ADMIN'] })), nextCursor: null } }));
    h.mock('GET', `/social/internal/v1/profiles/${ids.admin}`, () => ({ body: { userId: ids.admin, displayName: 'Admin Ana' } }));
    const res = await h.gql('query($after:String){ reports(first: 2, after: $after, status: READY) { edges { node { id title status locale requestedBy { id } markdown audioUrl } } pageInfo { hasNextPage endCursor } } }', { token: admin, variables: { after: 'C1' } });
    expect(res.body.errors).toBeUndefined();
    const { edges, pageInfo } = res.body.data.reports;
    expect(edges.map((e: { node: { requestedBy: { id: string } | null } }) => e.node.requestedBy?.id ?? null)).toEqual([ids.admin, null]);
    expect(edges[0].node).toMatchObject({ id: U(1), status: 'READY', locale: 'es', markdown: null, audioUrl: null });
    expect(pageInfo).toEqual({ hasNextPage: true, endCursor: 'C2' });
    const call = h.callsTo('/insights/internal/v1/reports')[0]!;
    expect(call.headers.authorization).toBe('Bearer svc-token');
    expect([call.query.get('cursor'), call.query.get('limit'), call.query.get('status')]).toEqual(['C1', '2', 'READY']);
  });

  it('report(id): full content with audio URL, null when it does not exist', async () => {
    h.mock('GET', `/insights/internal/v1/reports/${U(1)}`, () => ({ body: report(U(1), { markdown: '## Hola', dataset: { columns: [{ name: 'a', type: 'integer' }], rows: [[1]] }, chart: { mark: 'bar' }, audioUrl: 'http://minio/x.mp3?X-Amz-Expires=900', audioDurationSeconds: 74 }) }));
    const ok = await h.gql(`{ report(id:"${U(1)}") { markdown dataset chart audioUrl audioDurationSeconds failureReason createdAt completedAt } }`, { token: admin });
    expect(ok.body.errors).toBeUndefined();
    expect(ok.body.data.report).toEqual({ markdown: '## Hola', dataset: { columns: [{ name: 'a', type: 'integer' }], rows: [[1]] }, chart: { mark: 'bar' }, audioUrl: 'http://minio/x.mp3?X-Amz-Expires=900', audioDurationSeconds: 74, failureReason: null, createdAt: '2026-10-14T15:04:05Z', completedAt: '2026-10-14T15:04:52Z' });
    const missing = await h.gql(`{ report(id:"${U(9)}") { id } }`, { token: admin });
    expect(missing.body.errors).toBeUndefined();
    expect(missing.body.data.report).toBeNull();
  });

  it('alerts: forwards the ADMIN token (public API) with filters, resolves acknowledgedBy and agentRun', async () => {
    h.mock('GET', '/insights/api/v1/insights/alerts', () => ({ body: { items: [alert(U(31), { status: 'ACKNOWLEDGED', acknowledgedBy: ids.admin, acknowledgedAt: '2026-10-14T15:10:00Z' })], nextCursor: null } }));
    h.mock('GET', `/insights/api/v1/insights/agent-runs/${U(50)}`, () => ({ body: { ...run(), steps: [{ index: 1, kind: 'TOOL_CALL', toolName: 'get_service_health', input: { includeQueues: true }, outputSummary: 'ok', isError: false, startedAt: '2026-10-14T15:00:01Z', durationMs: 12 }] } }));
    h.mock('GET', '/identity/internal/v1/users', (c) => ({ body: { items: (c.query.get('ids') ?? '').split(',').filter(Boolean).map((id) => user(id)), nextCursor: null } }));
    const res = await h.gql('{ alerts(status: ACKNOWLEDGED, severity: WARNING, first: 10) { id severity kind status resource occurrences details acknowledgedBy { id } agentRun { id agent steps { index toolName } } } }', { token: admin });
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.alerts).toEqual([{ id: U(31), severity: 'WARNING', kind: 'SERVICE_DOWN', status: 'ACKNOWLEDGED', resource: 'wallet-service', occurrences: 2, details: { service: 'wallet-service' }, acknowledgedBy: { id: ids.admin }, agentRun: { id: U(50), agent: 'MONITORING', steps: [{ index: 1, toolName: 'get_service_health' }] } }]);
    const call = h.callsTo('/insights/api/v1/insights/alerts')[0]!;
    expect(call.headers.authorization).toBe(`Bearer ${admin}`);
    expect([call.query.get('status'), call.query.get('severity'), call.query.get('limit')]).toEqual(['ACKNOWLEDGED', 'WARNING', '10']);
  });

  it('agentRuns: paginated list; nested report, alerts and steps come on demand', async () => {
    h.mock('GET', '/insights/internal/v1/agent-runs', () => ({ body: { items: [run({ reportId: U(1) })], nextCursor: null } }));
    h.mock('GET', `/insights/internal/v1/reports/${U(1)}`, () => ({ body: report(U(1)) }));
    h.mock('GET', '/insights/api/v1/insights/alerts', () => ({ body: { items: [alert(U(31)), alert(U(32))], nextCursor: null } }));
    h.mock('GET', `/insights/api/v1/insights/agent-runs/${U(50)}`, () => ({ body: { ...run(), steps: [] } }));
    h.mock('GET', '/identity/internal/v1/users', () => ({ body: { items: [user(ids.admin)], nextCursor: null } }));
    const res = await h.gql('{ agentRuns(first: 5, agent: MONITORING) { edges { node { id agent trigger status toolsUsed tokens { total } stopReason error report { id title } alerts { id } steps { index } } } pageInfo { hasNextPage } } }', { token: admin });
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.agentRuns.edges[0].node).toEqual({ id: U(50), agent: 'MONITORING', trigger: 'MANUAL', status: 'SUCCEEDED', toolsUsed: ['get_service_health'], tokens: { total: 0 }, stopReason: 'COMPLETED', error: null, report: { id: U(1), title: 'Inscripciones' }, alerts: [{ id: U(31) }], steps: [] });
    expect(h.callsTo('/insights/internal/v1/agent-runs')[0]!.query.get('agent')).toBe('MONITORING');
  });

  it('is ADMIN only: MODERATOR gets FORBIDDEN before any call reaches insights', async () => {
    for (const q of ['{ alerts { id } }', '{ reports { edges { cursor } } }', '{ agentRuns { edges { cursor } } }', 'mutation { runMonitoringNow { errors { code } } }']) {
      expect(code(await h.gql(q, { token: moderator }))).toBe('FORBIDDEN');
    }
    expect(code(await h.gql('{ alerts { id } }'))).toBe('UNAUTHENTICATED');
    expect(h.callsTo('/insights')).toHaveLength(0);
  });

  it('a failing insights service becomes SERVICE_UNAVAILABLE (never a stack trace)', async () => {
    h.mock('GET', '/insights/internal/v1/reports', () => ({ status: 503, body: { code: 'SERVICE_UNAVAILABLE', status: 503 } }));
    const res = await h.gql('{ reports { edges { cursor } } }', { token: admin });
    expect(code(res)).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('insights mutations (phase 2)', () => {
  it('requestReport: public POST as the ADMIN with Idempotency-Key and the requested locale, then returns the report', async () => {
    h.mock('POST', '/insights/api/v1/insights/reports', () => ({ status: 202, body: { reportId: U(1), agentRunId: U(50), status: 'PENDING', locale: 'en' } }));
    h.mock('GET', `/insights/api/v1/insights/reports/${U(1)}`, () => ({ body: report(U(1), { status: 'PENDING', title: null, locale: 'en', hasAudio: false, completedAt: null }) }));
    h.mock('GET', '/identity/internal/v1/users', () => ({ body: { items: [user(ids.admin)], nextCursor: null } }));
    const res = await h.gql('mutation { requestReport(question: "How many registrations last month?", locale: en) { report { id status locale requestedBy { id } } errors { code } } }', { token: admin });
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.requestReport).toEqual({ report: { id: U(1), status: 'PENDING', locale: 'en', requestedBy: { id: ids.admin } }, errors: [] });
    const call = h.callsTo('/insights/api/v1/insights/reports').find((c) => c.method === 'POST')!;
    expect(call.headers.authorization).toBe(`Bearer ${admin}`);
    expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(call.body).toEqual({ question: 'How many registrations last month?', locale: 'en' });
  });

  it('requestReport: business errors of insights come back as UserError (VALIDATION_FAILED with field)', async () => {
    h.mock('POST', '/insights/api/v1/insights/reports', () => ({ status: 422, body: { code: 'VALIDATION_FAILED', status: 422, title: 'Solicitud no válida', detail: 'Revisa los campos enviados.', errors: [{ field: '/question', code: 'OUT_OF_RANGE', message: 'question must have between 10 and 1000 characters' }] } }));
    const res = await h.gql('mutation { requestReport(question: "corta") { report { id } errors { code message field } } }', { token: admin });
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.requestReport.report).toBeNull();
    expect(res.body.data.requestReport.errors[0]).toMatchObject({ code: 'VALIDATION_FAILED', field: ['question'] });
  });

  it('acknowledgeAlert: public ack as the ADMIN; unknown alert -> ALERT_NOT_FOUND user error', async () => {
    h.mock('POST', `/insights/api/v1/insights/alerts/${U(31)}/ack`, () => ({ body: alert(U(31), { status: 'ACKNOWLEDGED', acknowledgedBy: ids.admin, acknowledgedAt: '2026-10-14T15:10:00Z' }) }));
    h.mock('POST', `/insights/api/v1/insights/alerts/${U(99)}/ack`, () => ({ status: 404, body: { code: 'ALERT_NOT_FOUND', status: 404, title: 'Alerta no encontrada' } }));
    h.mock('GET', '/identity/internal/v1/users', () => ({ body: { items: [user(ids.admin)], nextCursor: null } }));
    const ok = await h.gql(`mutation { acknowledgeAlert(id:"${U(31)}") { alert { id status acknowledgedBy { id } } errors { code } } }`, { token: admin });
    expect(ok.body.data.acknowledgeAlert).toEqual({ alert: { id: U(31), status: 'ACKNOWLEDGED', acknowledgedBy: { id: ids.admin } }, errors: [] });
    expect(h.callsTo(`/insights/api/v1/insights/alerts/${U(31)}/ack`)[0]!.headers.authorization).toBe(`Bearer ${admin}`);
    const missing = await h.gql(`mutation { acknowledgeAlert(id:"${U(99)}") { alert { id } errors { code } } }`, { token: admin });
    expect(missing.body.data.acknowledgeAlert).toEqual({ alert: null, errors: [{ code: 'ALERT_NOT_FOUND' }] });
  });

  it('runMonitoringNow: internal POST with the admin as requestedBy + Idempotency-Key, returns the run', async () => {
    h.mock('POST', '/insights/internal/v1/agents/monitoring/runs', () => ({ status: 202, body: { agentRunId: U(50), status: 'RUNNING' } }));
    h.mock('GET', `/insights/api/v1/insights/agent-runs/${U(50)}`, () => ({ body: { ...run({ status: 'RUNNING', finishedAt: null }), steps: [] } }));
    const res = await h.gql('mutation { runMonitoringNow { agentRun { id agent status trigger } errors { code } } }', { token: admin });
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.runMonitoringNow).toEqual({ agentRun: { id: U(50), agent: 'MONITORING', status: 'RUNNING', trigger: 'MANUAL' }, errors: [] });
    const call = h.callsTo('/insights/internal/v1/agents/monitoring/runs')[0]!;
    expect(call.headers.authorization).toBe('Bearer svc-token');
    expect(call.body).toEqual({ requestedBy: ids.admin });
    expect(call.headers['idempotency-key']).toBeTruthy();
  });
});

describe('insights subscriptions (graphql-ws + RabbitMQ)', () => {
  const subscribe = (token: string, query: string, publish: () => Promise<void>) =>
    new Promise<{ data?: unknown; errors?: unknown }>((resolve, reject) => {
      const client = h.wsClient(token);
      let done = false;
      let timer: NodeJS.Timeout | undefined;
      client.subscribe({ query }, { next: (v) => { done = true; clearInterval(timer); resolve(v as never); void client.dispose(); }, error: (e) => reject(e instanceof Error ? e : new Error(JSON.stringify(e))), complete: () => undefined });
      client.on('connected', () => {
        // the instance queue is declared asynchronously at boot: keep publishing until delivered
        timer = setInterval(() => { if (!done) void publish(); }, 300);
        setTimeout(() => { done = true; clearInterval(timer); }, 10_000);
      });
    });

  it('alertRaised delivers alert.raised events and honors minSeverity', async () => {
    const publishBoth = async () => {
      await h.publish('bandada.insights.alert.raised.v1', { alertId: U(40), severity: 'INFO', kind: 'METRIC_ANOMALY', message: 'ruido', details: { metric: 'posts' }, agentRunId: null, occurredAt: '2026-10-14T15:00:00Z' });
      await h.publish('bandada.insights.alert.raised.v1', { alertId: U(41), severity: 'CRITICAL', kind: 'SERVICE_DOWN', message: 'wallet caído', details: { service: 'wallet-service' }, agentRunId: U(50), occurredAt: '2026-10-14T15:00:01Z' });
    };
    const res = await subscribe(admin, 'subscription { alertRaised(minSeverity: WARNING) { id severity kind message status resource occurrences raisedAt } }', publishBoth);
    expect(res.errors).toBeUndefined();
    expect(res.data).toEqual({ alertRaised: { id: U(41), severity: 'CRITICAL', kind: 'SERVICE_DOWN', message: 'wallet caído', status: 'OPEN', resource: 'wallet-service', occurrences: 1, raisedAt: '2026-10-14T15:00:01Z' } });
  });

  it('reportReady delivers when the report.ready event arrives, and immediately if the report is already READY', async () => {
    h.mock('GET', `/insights/internal/v1/reports/${U(2)}`, () => ({ body: report(U(2), { markdown: '## Listo' }) }));
    const viaEvent = await subscribe(admin, `subscription { reportReady(id:"${U(3)}") { id status markdown } }`, async () => {
      h.mock('GET', `/insights/internal/v1/reports/${U(3)}`, () => ({ body: report(U(3), { status: 'RUNNING', markdown: null }) }));
      await h.publish('bandada.insights.report.ready.v1', { reportId: U(3), requestedBy: ids.admin, status: 'READY', title: 'x', locale: 'es', hasAudio: false, occurredAt: '2026-10-14T15:00:00Z' });
      h.mock('GET', `/insights/internal/v1/reports/${U(3)}`, () => ({ body: report(U(3), { markdown: '## Por evento' }) }));
    });
    expect(viaEvent.data).toMatchObject({ reportReady: { id: U(3), status: 'READY' } });
    const already = await subscribe(admin, `subscription { reportReady(id:"${U(2)}") { id status markdown } }`, async () => undefined);
    expect(already.data).toEqual({ reportReady: { id: U(2), status: 'READY', markdown: '## Listo' } });
  });
});
