import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import request from 'supertest';

import { FakeTts } from '../support/fakes';
import { FakePlatform } from './support/fake-platform';
import { type Harness, startHarness } from './support/harness';

let h: Harness;
const platform = new FakePlatform();
const tts = new FakeTts(true);
const key = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-0000-0000-000000000000`.slice(0, 36).padEnd(36, '0');
const uuidKey = () => '00000000-0000-4000-8000-' + String(Math.floor(Math.random() * 1e12)).padStart(12, '0');
void key;

beforeAll(async () => {
  h = await startHarness({ platformData: platform, overrides: { tts } });
});
afterAll(async () => {
  await h.close();
});

const api = () => request(h.url);
const admin = () => h.token('01a13db2-c507-7f39-abfa-4388854ecb66', ['ADMIN', 'STUDENT']);

async function waitFor<T>(fn: () => Promise<T | undefined>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('REST: reports (UC-19)', () => {
  it('rejects anonymous (401), non-admin (403) and invalid bodies (422 with field errors, localized)', async () => {
    await api().post('/api/v1/insights/reports').set('Idempotency-Key', uuidKey()).send({ question: 'una pregunta valida de prueba' }).expect(401);
    const student = await h.token('u-student', ['STUDENT']);
    await api().post('/api/v1/insights/reports').set('Authorization', `Bearer ${student}`).set('Idempotency-Key', uuidKey()).send({ question: 'una pregunta valida de prueba' }).expect(403);
    const bad = await api().post('/api/v1/insights/reports').set('Authorization', `Bearer ${await admin()}`).set('Idempotency-Key', uuidKey()).set('Accept-Language', 'en').send({ question: 'corta', locale: 'fr', extra: 1 }).expect(422);
    expect(bad.headers['content-type']).toContain('application/problem+json');
    expect(bad.body).toMatchObject({ code: 'VALIDATION_FAILED', title: 'Invalid request', status: 422 });
    expect(bad.body.errors.map((e: { field: string }) => e.field).sort()).toEqual(['/extra', '/locale', '/question']);
    await api().post('/api/v1/insights/reports').set('Authorization', `Bearer ${await admin()}`).send({ question: 'una pregunta valida de prueba' }).expect(400); // Idempotency-Key required
  });

  it('202 + Location, Idempotency-Key replay, READY with markdown/dataset/chart/audio (presigned URL), audit run and outbox event', async () => {
    const token = await admin();
    const idem = uuidKey();
    const body = { question: '¿Cuántas inscripciones hubo y cuántos créditos se usaron en el último mes?', locale: 'es' };
    const first = await api().post('/api/v1/insights/reports').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', idem).send(body).expect(202);
    expect(first.body).toMatchObject({ status: 'PENDING', locale: 'es' });
    expect(first.headers.location).toBe(`/api/v1/insights/reports/${first.body.reportId}`);
    const replay = await api().post('/api/v1/insights/reports').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', idem).send(body).expect(202);
    expect(replay.body.reportId).toBe(first.body.reportId);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    await api().post('/api/v1/insights/reports').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', idem).send({ ...body, locale: 'en' }).expect(422); // same key, other body

    const report = await waitFor(async () => {
      const r = await api().get(`/api/v1/insights/reports/${first.body.reportId}`).set('Authorization', `Bearer ${token}`).expect(200);
      return r.body.status === 'READY' || r.body.status === 'FAILED' ? r.body : undefined;
    });
    expect(report).toMatchObject({ status: 'READY', locale: 'es', hasAudio: true, failureReason: null, fidelityWarning: false });
    expect(report.markdown).toContain('## Resumen de la plataforma');
    expect(report.markdown).toMatch(/11 confirmadas/);
    expect(report.dataset.rows.length).toBeGreaterThan(0);
    expect(report.datasetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.chart.$schema).toBe('https://vega.github.io/schema/vega-lite/v5.json');
    expect(JSON.stringify(report.chart)).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
    expect(report.audioDurationSeconds).toBeLessThanOrEqual(90);
    h.s3KeysToClean.push(`reports/${report.id}/summary.es.mp3`);
    const audio = await fetch(report.audioUrl);
    expect(audio.status).toBe(200);
    expect(Buffer.from(await audio.arrayBuffer()).toString()).toBe('ID3fake');
    expect(tts.spoken.at(-1)).toMatch(/Resumen en audio/);

    const runRes = await api().get(`/api/v1/insights/agent-runs/${first.body.agentRunId}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(runRes.body).toMatchObject({ agent: 'REPORT', trigger: 'REPORT_REQUEST', status: 'SUCCEEDED', stopReason: 'COMPLETED', reportId: report.id, llmProvider: 'stub' });
    expect(runRes.body.toolsUsed).toEqual(expect.arrayContaining(['get_platform_kpis', 'get_registration_stats']));
    expect(runRes.body.steps.filter((s: { kind: string }) => s.kind === 'TOOL_CALL').length).toBeGreaterThanOrEqual(2);
    expect(runRes.body.tokens.total).toBeGreaterThan(0);
    // the agent went through the MCP server (HTTP loopback) and the server read the platform
    expect(platform.calls).toEqual(expect.arrayContaining(['registrationStats']));
    expect((await h.outbox()).map((o) => o.routingKey)).toContain('bandada.insights.report.ready.v1');
  });

  it('English reports: English text, en audio, Content-Language', async () => {
    const token = await admin();
    const r = await api().post('/api/v1/insights/reports').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', uuidKey()).send({ question: 'How many registrations were there last month?', locale: 'en' }).expect(202);
    expect(r.body.locale).toBe('en');
    const report = await waitFor(async () => {
      const x = await api().get(`/api/v1/insights/reports/${r.body.reportId}`).set('Authorization', `Bearer ${token}`);
      return x.body.status === 'READY' ? x : undefined;
    });
    expect(report.headers['content-language']).toBe('en');
    expect(report.body.markdown).toContain('## Platform summary');
    expect(report.body.markdown).toContain('11 confirmed');
    expect(report.body.markdown).toContain('## Limitations');
    h.s3KeysToClean.push(`reports/${r.body.reportId}/summary.en.mp3`);
  });

  it('unknown / malformed ids are 404 REPORT_NOT_FOUND in the caller language', async () => {
    const token = await admin();
    const es = await api().get('/api/v1/insights/reports/00000000-0000-7000-8000-000000000999').set('Authorization', `Bearer ${token}`).expect(404);
    expect(es.body).toMatchObject({ code: 'REPORT_NOT_FOUND', title: 'Reporte no encontrado' });
    const en = await api().get('/api/v1/insights/reports/not-a-uuid').set('Authorization', `Bearer ${token}`).set('Accept-Language', 'en').expect(404);
    expect(en.body.title).toBe('Report not found');
  });

  it('internal API: requestReportInternal (n8n wf-04) with service token, getReportInternal, listReports, system requester', async () => {
    const svc = await h.serviceToken();
    await api().post('/internal/v1/reports').set('Idempotency-Key', uuidKey()).send({ question: 'Resume la actividad de la semana pasada en la plataforma' }).expect(401);
    const r = await api().post('/internal/v1/reports').set('Authorization', `Bearer ${svc}`).set('Idempotency-Key', uuidKey()).send({ question: 'Resume la actividad de la semana pasada en la plataforma', locale: 'es' }).expect(202);
    const done = await waitFor(async () => {
      const x = await api().get(`/internal/v1/reports/${r.body.reportId}`).set('Authorization', `Bearer ${svc}`).expect(200);
      return x.body.status === 'READY' ? x.body : undefined;
    });
    expect(done.requestedBy).toBe('system:insights-service');
    h.s3KeysToClean.push(`reports/${r.body.reportId}/summary.es.mp3`);
    const list = await api().get('/internal/v1/reports?limit=2').set('Authorization', `Bearer ${svc}`).expect(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    expect(list.body.items[0]).not.toHaveProperty('markdown');
    const userTokenOnInternal = await admin();
    await api().get('/internal/v1/reports').set('Authorization', `Bearer ${userTokenOnInternal}`).expect(401); // user tokens never work on /internal
  });
});

describe('REST: alerts and monitoring (UC-20)', () => {
  it('raiseAlert (internal, idempotent) -> list/filter -> acknowledge (idempotent) with Problem Details', async () => {
    const svc = await h.serviceToken('n8n');
    const token = await admin();
    const idem = uuidKey();
    const body = { severity: 'WARNING', kind: 'MODERATION_ESCALATION', message: 'El autor acumula 3 contenidos marcados en 24 h.', details: { authorId: '00000000-0000-7000-8000-0000000000a1', flaggedCount24h: 3 }, source: 'N8N' };
    const created = await api().post('/internal/v1/alerts').set('Authorization', `Bearer ${svc}`).set('Idempotency-Key', idem).send(body).expect(201);
    expect(created.body).toMatchObject({ severity: 'WARNING', kind: 'MODERATION_ESCALATION', status: 'OPEN', source: 'N8N', occurrences: 1 });
    const replay = await api().post('/internal/v1/alerts').set('Authorization', `Bearer ${svc}`).set('Idempotency-Key', idem).send(body).expect(201);
    expect(replay.body.id).toBe(created.body.id);
    // same problem again with another key: deduped by fingerprint, occurrences grow
    const again = await api().post('/internal/v1/alerts').set('Authorization', `Bearer ${svc}`).set('Idempotency-Key', uuidKey()).send(body).expect(201);
    expect([again.body.id, again.body.occurrences]).toEqual([created.body.id, 2]);
    await api().post('/internal/v1/alerts').set('Authorization', `Bearer ${svc}`).set('Idempotency-Key', uuidKey()).send({ severity: 'LOUD', kind: 'X', message: '' }).expect(422);

    const list = await api().get('/api/v1/insights/alerts?status=OPEN&severity=WARNING').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body.items.map((a: { id: string }) => a.id)).toContain(created.body.id);
    await api().get('/api/v1/insights/alerts?status=BOGUS').set('Authorization', `Bearer ${token}`).expect(422);
    await api().get('/api/v1/insights/alerts').expect(401);

    const ack = await api().post(`/api/v1/insights/alerts/${created.body.id}/ack`).set('Authorization', `Bearer ${token}`).send({ note: 'Revisando' }).expect(200);
    expect(ack.body).toMatchObject({ status: 'ACKNOWLEDGED', acknowledgedBy: '01a13db2-c507-7f39-abfa-4388854ecb66', note: 'Revisando' });
    const ack2 = await api().post(`/api/v1/insights/alerts/${created.body.id}/ack`).set('Authorization', `Bearer ${token}`).send({}).expect(200);
    expect(ack2.body.acknowledgedAt).toBe(ack.body.acknowledgedAt);
    const missing = await api().post('/api/v1/insights/alerts/00000000-0000-7000-8000-000000000999/ack').set('Authorization', `Bearer ${token}`).send({}).expect(404);
    expect(missing.body.code).toBe('ALERT_NOT_FOUND');
    expect((await h.outbox()).filter((o) => o.routingKey === 'bandada.insights.alert.raised.v1').length).toBeGreaterThanOrEqual(1);
  });

  it('runMonitoringNow runs the agent over MCP: a down service becomes an alert + outbox event + explanation; a second run dedupes and escalates', async () => {
    const svc = await h.serviceToken();
    const token = await admin();
    platform.health = { ...platform.health, overall: 'DOWN', services: platform.health.services.map((s) => (s.name === 'wallet-service' ? { ...s, status: 'DOWN' as const, error: 'HTTP 503' } : s)) };
    const start = async () => {
      const r = await api().post('/internal/v1/agents/monitoring/runs').set('Authorization', `Bearer ${svc}`).set('Idempotency-Key', uuidKey()).send({}).expect(202);
      return waitFor(async () => {
        const run = await api().get(`/api/v1/insights/agent-runs/${r.body.agentRunId}`).set('Authorization', `Bearer ${token}`);
        return run.body.status && run.body.status !== 'RUNNING' ? run.body : undefined;
      });
    };
    const run1 = await start();
    expect(run1).toMatchObject({ agent: 'MONITORING', trigger: 'MANUAL', status: 'SUCCEEDED' });
    expect(run1.toolsUsed).toEqual(expect.arrayContaining(['get_service_health', 'list_failed_sagas', 'raise_alert']));
    expect(run1.alertIds).toHaveLength(1);
    const alerts = await api().get('/api/v1/insights/alerts?status=OPEN').set('Authorization', `Bearer ${token}`).expect(200);
    const alert = alerts.body.items.find((a: { id: string }) => a.id === run1.alertIds[0]);
    expect(alert).toMatchObject({ kind: 'SERVICE_DOWN', severity: 'WARNING', resource: 'wallet-service', source: 'MONITORING_AGENT', agentRunId: run1.id });
    expect(alert.explanation).toContain('wallet-service');
    const run2 = await start();
    expect(run2.alertIds).toEqual(run1.alertIds);
    const after = await api().get('/api/v1/insights/alerts?status=OPEN').set('Authorization', `Bearer ${token}`).expect(200);
    expect(after.body.items.find((a: { id: string }) => a.id === alert.id)).toMatchObject({ severity: 'CRITICAL', occurrences: 2 });
    const events = (await h.outbox()).filter((o) => o.routingKey === 'bandada.insights.alert.raised.v1').map((o) => (o.payload as { data: { alertId: string; severity: string } }).data);
    expect(events.filter((e) => e.alertId === alert.id).map((e) => e.severity)).toEqual(expect.arrayContaining(['WARNING', 'CRITICAL']));
    platform.health = { ...platform.health, overall: 'UP', services: platform.health.services.map((s) => ({ ...s, status: 'UP' as const, error: null })) };
    const runs = await api().get('/internal/v1/agent-runs?agent=MONITORING&limit=5').set('Authorization', `Bearer ${svc}`).expect(200);
    expect(runs.body.items.length).toBeGreaterThanOrEqual(2);
  });

  it('internal kpis and service-health', async () => {
    const svc = await h.serviceToken();
    const kpis = await api().get('/internal/v1/kpis?from=2026-10-01&to=2026-10-15').set('Authorization', `Bearer ${svc}`).expect(200);
    expect(kpis.body).toMatchObject({ from: '2026-10-01', to: '2026-10-15', openAlerts: expect.any(Number) });
    expect(kpis.body.series).toHaveLength(15);
    await api().get('/internal/v1/kpis?from=2026-10-10&to=2026-10-01').set('Authorization', `Bearer ${svc}`).expect(422);
    const health = await api().get('/internal/v1/service-health').set('Authorization', `Bearer ${svc}`).expect(200);
    expect(health.body.services.length).toBeGreaterThan(0);
    expect(health.headers['cache-control']).toBe('no-store');
  });

  it('health endpoints', async () => {
    expect((await api().get('/health/live').expect(200)).body.status).toBe('UP');
    expect((await api().get('/health/ready').expect(200)).body).toEqual({ status: 'UP', checks: { dynamodb: 'UP' } });
  });
});

describe('MCP over HTTP (Streamable HTTP, stateless) with the official SDK client', () => {
  const connect = async (token: string) => {
    const client = new Client({ name: 'it', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    return client;
  };

  it('initialize + tools/list + tools/call with an ADMIN token; raise_alert is hidden; the call is audited as EXTERNAL_MCP', async () => {
    const client = await connect(await admin());
    expect(client.getServerVersion()).toMatchObject({ name: 'bandada-insights' });
    expect(client.getServerCapabilities()).toMatchObject({ tools: {}, resources: {}, prompts: {} });
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toHaveLength(11);
    expect(tools).not.toContain('raise_alert');
    const res = await client.callTool({ name: 'get_platform_kpis', arguments: { from: '2026-10-01', to: '2026-10-15' } });
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toMatchObject({ from: '2026-10-01', to: '2026-10-15' });
    const stats = await client.callTool({ name: 'get_registration_stats', arguments: { from: '2026-10-01', to: '2026-10-15' } });
    expect(stats.structuredContent).toMatchObject({ totals: { confirmed: 11 } });
    await expect(client.callTool({ name: 'get_platform_kpis', arguments: { from: 'x' } })).rejects.toMatchObject({ code: -32602 });
    expect(((await client.readResource({ uri: 'bandada://kpis/today' })).contents[0] as { mimeType: string }).mimeType).toBe('application/json');
    expect((await client.listPrompts()).prompts).toHaveLength(2);
    await client.close();
    const svc = await h.serviceToken();
    const audits = await api().get('/internal/v1/agent-runs?agent=EXTERNAL_MCP&limit=10').set('Authorization', `Bearer ${svc}`).expect(200);
    expect(audits.body.items.some((r: { toolsUsed: string[] }) => r.toolsUsed.includes('get_platform_kpis'))).toBe(true);
  });

  it('a service token sees raise_alert and can call it; n8n is rejected; students and app-audience tokens are refused', async () => {
    const svcClient = await connect(await h.serviceToken());
    const tools = (await svcClient.listTools()).tools.map((t) => t.name);
    expect(tools).toHaveLength(12);
    const out = await svcClient.callTool({ name: 'raise_alert', arguments: { severity: 'INFO', kind: 'METRIC_ANOMALY', message: 'Prueba MCP', dedupeKey: 'METRIC_ANOMALY:it-test' } });
    expect(out.structuredContent).toMatchObject({ created: true, status: 'OPEN' });
    await svcClient.close();
    await expect(connect(await h.serviceToken('n8n'))).rejects.toThrow(/403|Forbidden/i);
    await expect(connect(await h.token('u-student', ['STUDENT']))).rejects.toThrow(/403|Forbidden/i);
    await expect(connect(await h.token('u-admin', ['ADMIN'], 'bandada-app'))).rejects.toThrow(/401|Unauthorized/i);
    await expect(connect('garbage')).rejects.toThrow(/401|Unauthorized/i);
  });

  it('raw HTTP behaviour: 401 + WWW-Authenticate, GET -> 405, foreign Origin -> 403, 1 MB body limit', async () => {
    const noAuth = await api().post('/mcp').set('Accept', 'application/json, text/event-stream').send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).expect(401);
    expect(noAuth.headers['www-authenticate']).toBe('Bearer realm="bandada-mcp"');
    expect(noAuth.body.code).toBe('UNAUTHORIZED');
    const token = await admin();
    const get = await api().get('/mcp').set('Authorization', `Bearer ${token}`).expect(405);
    expect(get.body.code).toBe('METHOD_NOT_ALLOWED');
    await api().post('/mcp').set('Authorization', `Bearer ${token}`).set('Origin', 'http://evil.example').set('Accept', 'application/json, text/event-stream').send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).expect(403);
    await api().post('/mcp').set('Authorization', `Bearer ${token}`).set('Accept', 'application/json, text/event-stream').send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'generate_report', arguments: { markdown: 'x'.repeat(1_100_000) } } }).expect(413);
  });

  it('generate_report over MCP stores a report for the caller and finishes it in the background', async () => {
    const client = await connect(await admin());
    const out = await client.callTool({ name: 'generate_report', arguments: { title: 'Reporte desde cliente MCP', question: 'Resumen de prueba', markdown: '## Hola\n\nSe registraron 11 inscripciones.', dataset: { columns: [{ name: 'k', type: 'string' }, { name: 'v', type: 'integer' }], rows: [['a', 11]] }, audioSummary: 'Once inscripciones.', locale: 'es' } });
    const { reportId, status, audioStatus, url } = out.structuredContent as { reportId: string; status: string; audioStatus: string; url: string };
    expect([status, audioStatus]).toEqual(['RUNNING', 'PENDING']);
    expect(url).toBe(`http://api.bandada.localhost/api/v1/insights/reports/${reportId}`);
    h.s3KeysToClean.push(`reports/${reportId}/summary.es.mp3`);
    await h.jobsIdle();
    const rep = await api().get(`/api/v1/insights/reports/${reportId}`).set('Authorization', `Bearer ${await admin()}`).expect(200);
    expect(rep.body).toMatchObject({ status: 'READY', title: 'Reporte desde cliente MCP', hasAudio: true });
    await client.close();
  });
});
