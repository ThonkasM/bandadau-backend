import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { commitTransaction,DynamoOutbox, DynamoTransaction } from '@bandada/messaging-ts';

import { newAgentRun } from '../../src/entities/agent-run';
import { newAlert } from '../../src/entities/alert';
import { newReport } from '../../src/entities/report';
import { DynamoAgentRunRepository, DynamoAlertRepository, DynamoLock, DynamoMetricRepository, DynamoReportRepository } from '../../src/interface-adapters/gateways/dynamo/dynamo-repositories';
import { DynamoStore } from '../../src/interface-adapters/gateways/dynamo/dynamo-store';
import { alertRaisedMessage, reportReadyMessage } from '../../src/use-cases/messages';
import { createTables, run, uuid } from './support/harness';

const table = `${run}-repos-insights`;
const idem = `${run}-repos-idem`;
const raw = new DynamoDBClient({ region: 'us-east-1', endpoint: process.env.IT_DYNAMODB_ENDPOINT });
const doc = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } });
let store: DynamoStore;

beforeAll(async () => {
  await createTables(raw, table, idem);
  store = new DynamoStore(doc, table, new DynamoOutbox({ client: doc, tableName: table }));
});
afterAll(async () => {
  await raw.send(new DeleteTableCommand({ TableName: table }));
  await raw.send(new DeleteTableCommand({ TableName: idem }));
});

const iso = (n: number) => new Date(Date.UTC(2026, 9, 15, 12, 0, n)).toISOString();

describe('Dynamo repositories (DynamoDB Local, own table)', () => {
  it('reports: round trip, outbox event in the SAME transaction, newest-first pagination with opaque cursors and status filter', async () => {
    const repo = new DynamoReportRepository(store);
    for (let i = 1; i <= 5; i++) {
      const r = newReport({ id: uuid(100 + i), question: `pregunta ${i}`, locale: i % 2 ? 'es' : 'en', requestedBy: 'u', agentRunId: uuid(200 + i), now: iso(i) });
      await repo.save(i === 5 ? { ...r, status: 'READY', title: 'Listo', completedAt: iso(9) } : r, i === 5 ? [reportReadyMessage({ ...r, status: 'READY', title: 'Listo' }, iso(9))] : []);
    }
    expect((await repo.findById(uuid(101)))?.question).toBe('pregunta 1');
    expect(await repo.findById(uuid(999))).toBeNull();
    const p1 = await repo.list({ limit: 2 });
    expect(p1.items.map((r) => r.id)).toEqual([uuid(105), uuid(104)]);
    expect(p1.nextCursor).toEqual(expect.any(String));
    const p2 = await repo.list({ limit: 2, cursor: p1.nextCursor! });
    expect(p2.items.map((r) => r.id)).toEqual([uuid(103), uuid(102)]);
    const p3 = await repo.list({ limit: 2, cursor: p2.nextCursor! });
    expect(p3).toEqual({ items: [expect.objectContaining({ id: uuid(101) })], nextCursor: null });
    expect((await repo.list({ limit: 10, status: 'READY' })).items.map((r) => r.id)).toEqual([uuid(105)]);
    expect((await repo.listUnfinished()).map((r) => r.id).sort()).toEqual([uuid(101), uuid(102), uuid(103), uuid(104)]);
    await expect(repo.list({ limit: 2, cursor: '%%%' })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    // outbox row written atomically with the report
    const outbox = await new DynamoOutbox({ client: doc, tableName: table }).claimBatch(10, 1000);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ exchange: 'bandada.events', routingKey: 'bandada.insights.report.ready.v1', payload: { type: 'bandada.insights.report.ready.v1', source: '/services/insights-service', data: { reportId: uuid(105), status: 'READY' } } });
  });

  it('agent runs: META + ordered STEP items, newest-first listing with agent filter, TTL attribute', async () => {
    const repo = new DynamoAgentRunRepository(store);
    const a = newAgentRun({ id: uuid(301), agent: 'REPORT', trigger: 'REPORT_REQUEST', requestedBy: 'u', locale: 'es', now: iso(1) });
    const b = newAgentRun({ id: uuid(302), agent: 'MONITORING', trigger: 'SCHEDULE', requestedBy: 'system', locale: 'es', now: iso(2) });
    await repo.create(a);
    await repo.create(b);
    for (const index of [2, 1, 3]) await repo.appendStep(a.id, { index, kind: index === 2 ? 'TOOL_CALL' : 'LLM', toolName: index === 2 ? 'get_platform_kpis' : null, input: null, outputSummary: 'x', isError: false, startedAt: iso(index), durationMs: 5 });
    await repo.update({ ...a, status: 'SUCCEEDED', stepCount: 3, finishedAt: iso(9), tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } });
    const found = (await repo.findById(a.id))!;
    expect(found.run).toMatchObject({ status: 'SUCCEEDED', tokens: { input: 10 } });
    expect(found.steps.map((s) => s.index)).toEqual([1, 2, 3]);
    expect((await repo.list({ limit: 10 })).items.map((r) => r.id)).toEqual([uuid(302), uuid(301)]);
    expect((await repo.list({ limit: 10, agent: 'REPORT' })).items.map((r) => r.id)).toEqual([uuid(301)]);
    const meta = await doc.send(new GetCommand({ TableName: table, Key: { pk: `AGENTRUN#${a.id}`, sk: 'META' } }));
    expect(meta.Item?.expiresAt).toBeGreaterThan(Date.now() / 1000 + 29 * 86_400);
    expect(await repo.findById(uuid(999))).toBeNull();
  });

  it('alerts: status partitions, fingerprint lookup, severity filter, merged pagination, status change moves the GSI key, outbox atomic', async () => {
    const repo = new DynamoAlertRepository(store);
    const mk = (n: number, over: Partial<ReturnType<typeof newAlert>> = {}) => ({ ...newAlert({ id: uuid(400 + n), now: iso(n), severity: n === 3 ? 'CRITICAL' : 'WARNING', kind: 'SERVICE_DOWN', message: `m${n}`, source: 'MONITORING_AGENT', resource: `svc-${n}` }), ...over });
    const [a1, a2, a3] = [mk(1), mk(2), mk(3)];
    await repo.save(a1, [alertRaisedMessage(a1, iso(1))]);
    await repo.save(a2);
    await repo.save(a3);
    expect((await repo.findActiveByFingerprint('SERVICE_DOWN:svc-2'))?.id).toBe(a2.id);
    expect(await repo.findActiveByFingerprint('SERVICE_DOWN:nope')).toBeNull();
    expect(await repo.countOpen()).toBe(3);
    await repo.save({ ...a2, status: 'ACKNOWLEDGED', acknowledgedBy: 'admin', acknowledgedAt: iso(5) });
    await repo.save({ ...a1, status: 'RESOLVED', resolvedBy: 'SYSTEM' });
    expect((await repo.list({ status: 'OPEN', limit: 10 })).items.map((a) => a.id)).toEqual([a3.id]);
    expect((await repo.list({ status: 'ACKNOWLEDGED', limit: 10 })).items.map((a) => a.id)).toEqual([a2.id]);
    expect((await repo.list({ limit: 10 })).items.map((a) => a.id)).toEqual([a3.id, a2.id, a1.id]);
    expect((await repo.list({ limit: 10, severity: 'CRITICAL' })).items.map((a) => a.id)).toEqual([a3.id]);
    const first = await repo.list({ limit: 2 });
    expect(first.items.map((a) => a.id)).toEqual([a3.id, a2.id]);
    expect((await repo.list({ limit: 2, cursor: first.nextCursor! })).items.map((a) => a.id)).toEqual([a1.id]);
    expect((await repo.listActive()).map((a) => a.id).sort()).toEqual([a2.id, a3.id]);
    expect(await repo.countOpen()).toBe(1);
    expect(await repo.findActiveByFingerprint('SERVICE_DOWN:svc-1')).toBeNull(); // resolved alerts do not dedupe new ones
    const pending = await new DynamoOutbox({ client: doc, tableName: table }).claimBatch(10, 1000);
    expect(pending.map((m) => m.routingKey)).toContain('bandada.insights.alert.raised.v1');
  });

  it('metrics: atomic increments, series by date range, active-user marker counts a user once per day', async () => {
    const repo = new DynamoMetricRepository(store);
    await repo.increment([{ name: 'posts', date: '2031-01-01', amount: 2 }, { name: 'posts', date: '2031-01-02', amount: 1 }, { name: 'posts', date: '2031-01-01', amount: 3 }]);
    expect(await repo.series('posts', '2031-01-01', '2031-01-31')).toEqual([{ name: 'posts', date: '2031-01-01', value: 5 }, { name: 'posts', date: '2031-01-02', value: 1 }]);
    expect(await repo.series('posts', '2031-01-02', '2031-01-02')).toHaveLength(1);
    expect(await repo.series('comments', '2031-01-01', '2031-01-31')).toEqual([]);
    for (const actor of ['u1', 'u2', 'u1']) {
      const tx = new DynamoTransaction(table);
      await repo.stageActiveUser(tx, '2031-02-01', actor);
      await commitTransaction(doc, tx.items);
    }
    expect((await repo.series('activeUsers', '2031-02-01', '2031-02-01'))[0]?.value).toBe(2);
  });

  it('locks: mutual exclusion, holder, expiry and owner-only release', async () => {
    const lock = new DynamoLock(store);
    expect(await lock.tryAcquire('monitoring', 60_000, 'run-a')).toBe(true);
    expect(await lock.tryAcquire('monitoring', 60_000, 'run-b')).toBe(false);
    expect(await lock.holder('monitoring')).toBe('run-a');
    await lock.release('monitoring', 'run-b'); // not the owner
    expect(await lock.holder('monitoring')).toBe('run-a');
    await lock.release('monitoring', 'run-a');
    expect(await lock.holder('monitoring')).toBeNull();
    expect(await lock.tryAcquire('short', 50, 'x')).toBe(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(await lock.tryAcquire('short', 50, 'y')).toBe(true); // expired lease can be taken over
    // two replicas racing for the same window: exactly one wins
    const wins = await Promise.all(Array.from({ length: 8 }, (_, i) => lock.tryAcquire('monitoring-window-2031-01-01T00:00', 60_000, `r${i}`)));
    expect(wins.filter(Boolean)).toHaveLength(1);
  });
});
