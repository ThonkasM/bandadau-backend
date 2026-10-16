import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { AuthError, type AuthPrincipal, type JwtVerifier } from '@bandada/auth-ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { MCP_TOOLS,McpServerFactory } from '../../../src/interface-adapters/controllers/mcp/mcp-server.factory';
import { StatAnomalyDetector } from '../../../src/interface-adapters/gateways/anomaly/stat-anomaly.detector';
import { PlatformDataGateway } from '../../../src/interface-adapters/gateways/internal-api/platform-data.gateway';
import { McpAuthenticator } from '../../../src/interface-adapters/gateways/security/mcp-auth';
import { IdentityMcpTokenStatus, type McpTokenState } from '../../../src/interface-adapters/gateways/security/mcp-token-status';
import { McpToolService } from '../../../src/use-cases/mcp-tools/mcp-tools';
import { RateLimiter } from '../../../src/use-cases/mcp-tools/rate-limiter';
import { DetectAnomaliesUseCase, GetPlatformKpisUseCase } from '../../../src/use-cases/metrics/metrics';
import { RaiseAlertUseCase } from '../../../src/use-cases/monitoring/alerts';
import { ReportFinalizer } from '../../../src/use-cases/reports/report-finalizer';
import { SaveExternalReportUseCase } from '../../../src/use-cases/reports/save-external-report';
import { FakeClock, FakeTts, InlineJobs, MemAlerts, MemMetrics, MemReports, MemRuns, MemStorage, SeqIds, silentLogger } from '../../support/fakes';

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });

/** Responses copied from the live internal APIs (events, wallet, social, media, RabbitMQ management). */
const upstream: Record<string, (url: URL) => Response> = {
  'events-service/internal/v1/stats/registrations': (u) =>
    json(u.searchParams.get('groupBy') === 'event'
      ? { from: '2026-09-01', to: '2026-10-31', groupBy: 'event', totals: { pending: 0, confirmed: 7, failed: 3, cancelled: 0, creditsCollected: 60, creditsRefunded: 0 }, series: [{ key: '01a13f35-f40e-71eb-80b9-340373caf45e', label: 'Smoke caos', pending: 0, confirmed: 0, failed: 1, cancelled: 0 }] }
      : { from: '2026-09-01', to: '2026-10-31', groupBy: 'day', totals: { pending: 0, confirmed: 7, failed: 3, cancelled: 0, creditsCollected: 60, creditsRefunded: 0 }, series: [{ key: '2026-10-15', label: '2026-10-15', pending: 0, confirmed: 7, failed: 3, cancelled: 0 }] }),
  'events-service/internal/v1/events': () => json({ items: [{ id: '01a13f35-f40e-71eb-80b9-340373caf45e', organizerId: 'o', title: 'Taller', startsAt: '2026-10-20T10:00:00Z', venue: 'Aula', capacity: 5, seatsTaken: 1, seatsAvailable: 4, priceCredits: 0, status: 'PUBLISHED' }], nextCursor: 'more' }),
  'events-service/internal/v1/sagas': () => json({ items: [{ id: '00000000-0000-7000-8000-000000000005', type: 'REGISTRATION', registrationId: '00000000-0000-7000-8000-000000000006', eventId: '01a13f35-f40e-71eb-80b9-340373caf45e', userId: '00000000-0000-7000-8000-000000000003', step: 'RELEASE_SEAT', status: 'COMPENSATED', failureReason: 'TICKET_ISSUE_FAILED', updatedAt: '2026-10-15T10:57:51Z' }], nextCursor: null }),
  'wallet-service/internal/v1/stats/credits': () => json({ from: '2026-09-01', to: '2026-10-31', groupBy: 'day', totals: { topUpCount: 7, topUpCredits: 400, debitCount: 6, debitCredits: 120, refundCount: 3, refundCredits: 60, netCredits: 340, circulatingCredits: 340 }, series: [{ date: '2026-09-01', topUpCredits: 0, debitCredits: 0, refundCredits: 0 }] }),
  'social-service/internal/v1/stats/daily': () => json({ from: '2026-10-01', to: '2026-10-31', days: [{ date: '2026-10-01', postsCreated: 2, commentsCreated: 1, reactionsSet: 3, followsCreated: 0, activeAuthors: 2, postsHidden: 0 }], topHashtags: [{ hashtag: 'bandada', count: 3 }] }),
  'media-service/internal/v1/media': () => json({ items: [{ id: '00000000-0000-7000-8000-000000000001', ownerId: '00000000-0000-7000-8000-000000000003', kind: 'IMAGE', status: 'FLAGGED', updatedAt: '2026-10-14T10:00:00Z', createdAt: '2026-10-14T09:00:00Z', moderationResults: [{ labels: ['nsfw'], scores: { nsfw: 0.91 } }] }], nextCursor: null }),
  'social-service/internal/v1/posts': () => json({ items: [{ id: '00000000-0000-7000-8000-000000000002', authorId: '00000000-0000-7000-8000-000000000004', text: 'texto largo', reportsCount: 3, updatedAt: '2026-10-14T11:00:00Z', createdAt: '2026-10-14T08:00:00Z' }], nextCursor: null }),
  'rabbitmq/api/queues': () => json([{ name: 'insights-service.analytics', messages_ready: 4, messages_unacknowledged: 0, consumers: 1 }, { name: 'x.dlq', messages_ready: 2, messages_unacknowledged: 0, consumers: 0 }]),
};
const hosts: Record<string, string> = { 'http://events:1': 'events-service', 'http://wallet:1': 'wallet-service', 'http://social:1': 'social-service', 'http://media:1': 'media-service', 'http://rabbit:1': 'rabbitmq' };
const fakeFetch = (async (input: URL | string) => {
  const url = new URL(String(input));
  const host = hosts[url.origin];
  if (url.pathname === '/health/ready') return json({ status: 'UP', checks: { dynamodb: 'UP' } });
  const handler = upstream[`${host}${url.pathname}`];
  return handler ? handler(url) : new Response('not found', { status: 404 });
}) as unknown as typeof fetch;

const gateway = () =>
  new PlatformDataGateway({
    services: { 'events-service': 'http://events:1', 'wallet-service': 'http://wallet:1', 'social-service': 'http://social:1', 'media-service': 'http://media:1', 'identity-service': 'http://events:1', 'media-service ': 'x', 'ticketing-service': 'http://events:1', 'notification-service': 'http://events:1', 'insights-service': 'http://events:1', 'admin-gateway': 'http://events:1' },
    tokens: { authHeaders: async () => ({ Authorization: 'Bearer t' }), invalidate: () => undefined },
    rabbit: { url: 'http://rabbit:1', user: 'u', password: 'p' },
    fetch: fakeFetch,
  });

function serverFactory(strict = true) {
  const clock = new FakeClock();
  const alerts = new MemAlerts();
  const reports = new MemReports();
  const metrics = new MemMetrics();
  const runs = new MemRuns();
  const jobs = new InlineJobs();
  const ids = new SeqIds();
  const kpis = new GetPlatformKpisUseCase(metrics, alerts);
  const finalizer = new ReportFinalizer(reports, new FakeTts(true), new MemStorage(), clock, silentLogger);
  const tools = new McpToolService(gateway(), kpis, new DetectAnomaliesUseCase(metrics, new StatAnomalyDetector()), new RaiseAlertUseCase(alerts, clock, ids), new SaveExternalReportUseCase(reports, finalizer, new FakeTts(true), clock, ids, jobs, 'es', 'http://api.test'));
  const factory = new McpServerFactory({ tools, kpis, alerts, runs, clock, ids, logger: silentLogger, callLimiter: new RateLimiter(clock, 30, 60_000), serviceCallLimiter: new RateLimiter(clock, 120, 60_000), reportLimiter: new RateLimiter(clock, 10, 3_600_000), strictOutput: strict });
  return { factory, alerts, runs, reports, jobs, clock };
}
const principal = (over: Partial<AuthPrincipal>): AuthPrincipal => ({ sub: 'u-admin', typ: 'user', roles: ['ADMIN'], scopes: [], aud: ['bandada-admin'], exp: 9_999_999_999, ...over });

async function connect(factory: McpServerFactory, p: AuthPrincipal) {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const server = factory.create({ principal: p, correlationId: 'corr-1' });
  await server.connect(st);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(ct);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

describe('MCP contract (bandadau-docs/contracts/mcp)', () => {
  it('the bundled tools.schema.json is identical to the normative contract in bandadau-docs', () => {
    const docs = resolve(__dirname, '../../../../../../bandadau-docs/contracts/mcp/tools.schema.json');
    if (!existsSync(docs)) return; // docs repo not checked out next to the backend (CI of this repo alone)
    const bundled = readFileSync(resolve(__dirname, '../../../src/interface-adapters/controllers/mcp/tools.schema.json'), 'utf8');
    expect(JSON.parse(bundled)).toEqual(JSON.parse(readFileSync(docs, 'utf8')));
  });

  it('exposes the 12 contract tools (service) / 11 without raise_alert (admin) with contract names, schemas and annotations', async () => {
    const { factory } = serverFactory();
    const svc = await connect(factory, principal({ sub: 'insights-service', typ: 'service', roles: [], aud: ['bandada-internal'] }));
    const all = (await svc.client.listTools()).tools;
    expect(all.map((t) => t.name).sort()).toEqual(MCP_TOOLS.map((t) => t.name).sort());
    expect(all).toHaveLength(12);
    for (const t of MCP_TOOLS) {
      const got = all.find((x) => x.name === t.name)!;
      expect(got.inputSchema).toEqual(t.inputSchema);
      expect(got.outputSchema).toEqual(t.outputSchema);
      expect(got.annotations).toMatchObject({ readOnlyHint: t.annotations?.readOnlyHint });
    }
    await svc.close();
    const adm = await connect(factory, principal({}));
    expect((await adm.client.listTools()).tools.map((t) => t.name)).not.toContain('raise_alert');
    expect((await adm.client.listTools()).tools).toHaveLength(11);
    await adm.close();
  });

  it('rejects arguments that violate the input schema (JSON-RPC -32602) and unknown / hidden tools', async () => {
    const { factory } = serverFactory();
    const { client, close } = await connect(factory, principal({}));
    await expect(client.callTool({ name: 'get_platform_kpis', arguments: { from: 'ayer', to: '2026-10-01' } })).rejects.toMatchObject({ code: -32602 });
    await expect(client.callTool({ name: 'get_platform_kpis', arguments: { from: '2026-10-01', to: '2026-10-01', extra: 1 } })).rejects.toMatchObject({ code: -32602 });
    await expect(client.callTool({ name: 'raise_alert', arguments: { severity: 'INFO', kind: 'SERVICE_DOWN', message: 'x', dedupeKey: 'k' } })).rejects.toMatchObject({ code: -32602 }); // hidden for admin
    await expect(client.callTool({ name: 'nope', arguments: {} })).rejects.toMatchObject({ code: -32602 });
    await close();
  });

  it('every tool answers with structuredContent that validates against its contract outputSchema (strict, SDK client validates too)', async () => {
    const { factory, alerts } = serverFactory();
    const ajv = new Ajv({ strict: false });
    addFormats(ajv);
    const { client, close } = await connect(factory, principal({ sub: 'insights-service', typ: 'service', roles: [], aud: ['bandada-internal'] }));
    await client.listTools();
    const calls: [string, Record<string, unknown>][] = [
      ['get_platform_kpis', { from: '2026-10-01', to: '2026-10-03' }],
      ['get_registration_stats', { from: '2026-09-01', to: '2026-10-31' }],
      ['get_registration_stats', { from: '2026-09-01', to: '2026-10-31', groupBy: 'event' }],
      ['get_registration_stats', { from: '2026-09-01', to: '2026-10-31', groupBy: 'status' }],
      ['list_events', { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z', limit: 1 }],
      ['get_credit_stats', { from: '2026-09-01', to: '2026-10-31' }],
      ['get_content_stats', { from: '2026-10-01', to: '2026-10-31' }],
      ['list_flagged_content', {}],
      ['list_failed_sagas', {}],
      ['get_service_health', {}],
      ['detect_anomalies', { metrics: ['posts'], from: '2026-10-01', to: '2026-10-31' }],
      ['generate_report', { title: 'Reporte de prueba', question: 'pregunta de prueba', markdown: '## x', locale: 'es' }],
      ['raise_alert', { severity: 'WARNING', kind: 'SERVICE_DOWN', message: 'x', dedupeKey: 'SERVICE_DOWN:a' }],
    ];
    for (const [name, args] of calls) {
      const res = await client.callTool({ name, arguments: args });
      if (res.isError) throw new Error(`${name}: ${(res.content as { text: string }[])[0]?.text}`);
      expect({ name, isError: res.isError ?? false, text: (res.content as { text: string }[])[0]?.text.slice(0, 200) }).toEqual({ name, isError: false, text: expect.any(String) });
      const schema = MCP_TOOLS.find((t) => t.name === name)!.outputSchema!;
      const validate = ajv.compile(schema);
      expect({ name, ok: validate(res.structuredContent), errors: validate.errors }).toEqual({ name, ok: true, errors: null });
    }
    expect(alerts.items.size).toBe(1);
    const flagged = (await client.callTool({ name: 'list_flagged_content', arguments: {} })).structuredContent as { totalPending: number; items: { authorId: string; source: string }[] };
    expect(flagged.totalPending).toBe(2);
    expect(JSON.stringify(flagged)).not.toMatch(/texto largo/); // never the post text
    await close();
  });

  it('upstream outage is a tool error (isError), not a JSON-RPC failure; query_metrics without Prometheus too', async () => {
    const { factory } = serverFactory();
    const { client, close } = await connect(factory, principal({}));
    const res = await client.callTool({ name: 'query_metrics', arguments: { query: 'dlq_depth' } });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0]!.text).toContain('UPSTREAM_UNAVAILABLE');
    const bad = await client.callTool({ name: 'query_metrics', arguments: { query: 'node_load1' } });
    expect((bad.content as { text: string }[])[0]!.text).toContain('VALIDATION_ERROR');
    await close();
  });

  it('serves the resources and prompts of the contract', async () => {
    const { factory, alerts } = serverFactory();
    const { client, close } = await connect(factory, principal({}));
    expect((await client.listResources()).resources.map((r) => r.uri).sort()).toEqual(['bandada://alerts/open', 'bandada://kpis/today']);
    const kpis = JSON.parse(((await client.readResource({ uri: 'bandada://kpis/today' })).contents[0] as { text: string }).text);
    expect(kpis).toMatchObject({ from: '2026-10-15', to: '2026-10-15', openAlerts: 0 });
    await alerts.save({ id: 'a1', severity: 'WARNING', kind: 'SERVICE_DOWN', message: 'm', explanation: null, details: {}, status: 'OPEN', source: 'MONITORING_AGENT', agentRunId: null, raisedAt: 't', lastSeenAt: 't', acknowledgedAt: null, acknowledgedBy: null, note: null, resource: 'a', fingerprint: 'f', occurrences: 1, quietRuns: 0, resolvedAt: null, resolvedBy: null });
    const open = JSON.parse(((await client.readResource({ uri: 'bandada://alerts/open' })).contents[0] as { text: string }).text);
    expect(open.items).toHaveLength(1);
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(['monthly_report', 'weekly_summary']);
    const monthly = await client.getPrompt({ name: 'monthly_report', arguments: { month: '2026-09', locale: 'en' } });
    expect((monthly.messages[0]!.content as { text: string }).text).toContain('2026-09');
    await expect(client.getPrompt({ name: 'monthly_report', arguments: { month: 'septiembre' } })).rejects.toMatchObject({ code: -32602 });
    await close();
  });

  it('audits every external tools/call as an EXTERNAL_MCP AgentRun (service calls are audited by their own run) and rate limits per sub', async () => {
    const { factory, runs, clock } = serverFactory();
    const { client, close } = await connect(factory, principal({}));
    await client.callTool({ name: 'get_platform_kpis', arguments: { from: '2026-10-01', to: '2026-10-01' } });
    const [run] = [...runs.runs.values()];
    expect(run).toMatchObject({ agent: 'EXTERNAL_MCP', status: 'SUCCEEDED', toolsUsed: ['get_platform_kpis'], requestedBy: 'u-admin' });
    expect(runs.steps.get(run!.id)![0]).toMatchObject({ toolName: 'get_platform_kpis', input: { from: '2026-10-01' } });
    for (let i = 0; i < 29; i++) await client.callTool({ name: 'get_platform_kpis', arguments: { from: '2026-10-01', to: '2026-10-01' } });
    const limited = await client.callTool({ name: 'get_platform_kpis', arguments: { from: '2026-10-01', to: '2026-10-01' } });
    expect(limited.isError).toBe(true);
    expect((limited.content as { text: string }[])[0]!.text).toContain('RATE_LIMITED');
    clock.advance(61_000);
    expect((await client.callTool({ name: 'get_platform_kpis', arguments: { from: '2026-10-01', to: '2026-10-01' } })).isError).toBeUndefined();
    await close();
  });

  it('limits generate_report to 10 per hour per user', async () => {
    const { factory } = serverFactory();
    const { client, close } = await connect(factory, principal({}));
    const call = () => client.callTool({ name: 'generate_report', arguments: { title: 'Reporte de prueba', question: 'q', markdown: '## x' } });
    for (let i = 0; i < 10; i++) {
      const r = await call();
      if (r.isError) throw new Error(String((r.content as { text: string }[])[0]?.text));
    }
    expect(((await call()).content as { text: string }[])[0]!.text).toContain('RATE_LIMITED');
    await close();
  });
});

describe('PlatformDataGateway', () => {
  it('serves health: 9 services in parallel, RabbitMQ queues with DLQ flag, overall DOWN when one probe fails', async () => {
    const g = gateway();
    const h = await g.serviceHealth({}, { includeQueues: true });
    expect(h.services).toHaveLength(9);
    expect(h.queues).toEqual([expect.objectContaining({ name: 'insights-service.analytics', isDeadLetter: false, consumers: 1 }), expect.objectContaining({ name: 'x.dlq', isDeadLetter: true, messagesReady: 2 })]);
    expect(h.overall).toBe('UP');
    const failing = new PlatformDataGateway({ services: { 'wallet-service': 'http://wallet:1' }, tokens: { authHeaders: async () => ({}), invalidate: () => undefined }, rabbit: { url: 'http://rabbit:1', user: 'u', password: 'p' }, fetch: (async () => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch });
    const down = await failing.serviceHealth({}, { includeQueues: true });
    expect(down.overall).toBe('DOWN');
    expect(down.services.find((s) => s.name === 'wallet-service')).toMatchObject({ status: 'DOWN', error: expect.stringContaining('ECONNREFUSED') });
    expect(down.queues).toEqual([]);
  });
  it('flags content from media (AI) and hidden posts (REPORTS) without author names or post text', async () => {
    const f = await gateway().flaggedContent({}, { source: 'ALL', limit: 10 });
    expect(f.items.map((i) => [i.source, i.kind, i.authorId])).toEqual([['AI', 'IMAGE', '00000000-0000-7000-8000-000000000003'], ['REPORTS', 'POST', '00000000-0000-7000-8000-000000000004']]);
    expect(f.items[0]).toMatchObject({ maxScore: 0.91, labels: ['nsfw'] });
    expect(JSON.stringify(f)).not.toContain('texto largo');
  });
  it('sends the service token and a UUID-only X-Actor-Id', async () => {
    const seen: Record<string, string>[] = [];
    const g = new PlatformDataGateway({ services: { 'wallet-service': 'http://wallet:1' }, tokens: { authHeaders: async (e) => { seen.push({ actor: e?.actorId ?? '' }); return { Authorization: 'Bearer t' }; }, invalidate: () => undefined }, rabbit: { url: 'http://rabbit:1', user: 'u', password: 'p' }, fetch: fakeFetch });
    await g.creditStats({ actorId: 'system:monitoring-agent' }, { from: '2026-09-01', to: '2026-10-31', groupBy: 'day' });
    await g.creditStats({ actorId: '01a13db2-c507-7f39-abfa-4388854ecb66' }, { from: '2026-09-01', to: '2026-10-31', groupBy: 'day' });
    expect(seen.map((s) => s.actor)).toEqual(['', '01a13db2-c507-7f39-abfa-4388854ecb66']);
  });
});

describe('McpAuthenticator (mcp.md section 3)', () => {
  const token = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  const verifier = (p: AuthPrincipal | AuthError): JwtVerifier => ({ verify: async () => { if (p instanceof AuthError) throw p; return p; } });
  const auth = (user: AuthPrincipal | AuthError, service: AuthPrincipal | AuthError = principal({ sub: 'insights-service', typ: 'service', roles: [], aud: ['bandada-internal'] }), scope = false) =>
    new McpAuthenticator({ jwksUrl: 'x', issuer: 'x', serviceClients: ['insights-service'], requireServiceScope: scope, userVerifier: verifier(user), serviceVerifier: verifier(service) });

  it('401 without bearer or with a malformed token', async () => {
    await expect(auth(principal({})).authenticate(undefined)).rejects.toMatchObject({ status: 401 });
    await expect(auth(principal({})).authenticate('Bearer not-a-jwt')).rejects.toMatchObject({ status: 401 });
  });
  it('ADMIN user tokens pass; STUDENT gets 403; verifier errors keep their 401', async () => {
    await expect(auth(principal({})).authenticate(`Bearer ${token({ typ: 'user' })}`)).resolves.toMatchObject({ sub: 'u-admin' });
    await expect(auth(principal({ roles: ['STUDENT'] })).authenticate(`Bearer ${token({ typ: 'user' })}`)).rejects.toMatchObject({ status: 403 });
    await expect(auth(AuthError.unauthorized('expired')).authenticate(`Bearer ${token({ typ: 'user' })}`)).rejects.toMatchObject({ status: 401 });
  });
  it('MCP tokens (aud mcp) need scope mcp:tools', async () => {
    await expect(auth(principal({ aud: ['mcp'], scopes: [] })).authenticate(`Bearer ${token({ typ: 'user' })}`)).rejects.toMatchObject({ status: 403 });
    await expect(auth(principal({ aud: ['mcp'], scopes: ['mcp:tools'] })).authenticate(`Bearer ${token({ typ: 'user' })}`)).resolves.toBeDefined();
  });
  it('service tokens: only listed clients (n8n is rejected); scope optional unless MCP_REQUIRE_SCOPE', async () => {
    const svc = `Bearer ${token({ typ: 'service' })}`;
    await expect(auth(principal({})).authenticate(svc)).resolves.toMatchObject({ typ: 'service' });
    await expect(auth(principal({}), principal({ sub: 'n8n', typ: 'service', roles: [], aud: ['bandada-internal'] })).authenticate(svc)).rejects.toMatchObject({ status: 403 });
    await expect(auth(principal({}), principal({ sub: 'insights-service', typ: 'service', roles: [], aud: ['bandada-internal'], scopes: ['internal:read'] }), true).authenticate(svc)).rejects.toMatchObject({ status: 403 });
  });
});

describe('MCP token status (revocation, UC-22)', () => {
  const token = `h.${Buffer.from(JSON.stringify({ typ: 'user' })).toString('base64url')}.s`;
  const verifier = (p: AuthPrincipal): JwtVerifier => ({ verify: async () => p });
  const mcpPrincipal = (extra: Partial<AuthPrincipal> = {}) => principal({ aud: ['mcp'], scopes: ['mcp:tools'], jti: 'jti-1', ...extra });
  const auth = (p: AuthPrincipal, check: (jti: string) => Promise<McpTokenState>) =>
    new McpAuthenticator({ jwksUrl: 'x', issuer: 'x', serviceClients: [], requireServiceScope: false, userVerifier: verifier(p), serviceVerifier: verifier(p), tokenStatus: { check } });

  it('active passes; revoked and unknown give 401; identity down fails closed with 503', async () => {
    await expect(auth(mcpPrincipal(), async () => 'active').authenticate(`Bearer ${token}`)).resolves.toBeDefined();
    await expect(auth(mcpPrincipal(), async () => 'revoked').authenticate(`Bearer ${token}`)).rejects.toMatchObject({ status: 401 });
    await expect(auth(mcpPrincipal(), async () => 'unknown').authenticate(`Bearer ${token}`)).rejects.toMatchObject({ status: 401 });
    await expect(auth(mcpPrincipal(), async () => { throw new Error('down'); }).authenticate(`Bearer ${token}`)).rejects.toMatchObject({ status: 503 });
    await expect(auth(mcpPrincipal({ jti: undefined }), async () => 'active').authenticate(`Bearer ${token}`)).rejects.toMatchObject({ status: 401 });
  });
  it('admin-panel tokens do not depend on identity being reachable for MCP token status', async () => {
    const check = jest.fn(async () => 'revoked' as McpTokenState);
    await expect(auth(principal({ aud: ['bandada-admin'] }), check).authenticate(`Bearer ${token}`)).resolves.toBeDefined();
    expect(check).not.toHaveBeenCalled();
  });
  it('IdentityMcpTokenStatus caches verdicts, maps 404 to unknown and does not cache errors', async () => {
    let now = 1000;
    const calls: string[] = [];
    let mode: 'ok' | 'revoked' | '404' | '500' = 'ok';
    const f = (async (url: URL) => {
      calls.push(String(url));
      const body = JSON.stringify({ id: 'x', revoked: mode === 'revoked', expiresAt: '2099-01-01T00:00:00Z' });
      if (mode === '404') return new Response('{}', { status: 404 });
      if (mode === '500') return new Response('', { status: 500 });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const c = new IdentityMcpTokenStatus({ identityUrl: 'http://identity:7001', tokens: { authHeaders: async () => ({ Authorization: 'Bearer s' }), invalidate: () => undefined }, cacheTtlMs: 5000, now: () => now, fetch: f });
    expect(await c.check('a')).toBe('active');
    mode = 'revoked';
    expect(await c.check('a')).toBe('active'); // cached
    expect(calls).toEqual(['http://identity:7001/internal/v1/mcp-tokens/a']);
    now += 6000;
    expect(await c.check('a')).toBe('revoked');
    mode = '404';
    expect(await c.check('b')).toBe('unknown');
    mode = '500';
    await expect(c.check('c')).rejects.toBeDefined();
    mode = 'ok';
    expect(await c.check('c')).toBe('active');
  });
});
