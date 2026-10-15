import { newAlert } from '../../../src/entities/alert';
import { DEFAULT_THRESHOLDS } from '../../../src/entities/policies/monitoring-rules';
import { AcknowledgeAlertUseCase, RaiseAlertUseCase } from '../../../src/use-cases/monitoring/alerts';
import { RunMonitoringUseCase } from '../../../src/use-cases/monitoring/run-monitoring';
import { FakeClock, FakeMcp, fakePrompts, MemAlerts, MemLocks, MemRuns, say, ScriptedLlm, SeqIds, silentLogger } from '../../support/fakes';

const health = (down: string[] = [], queues: { name: string; messagesReady: number; isDeadLetter: boolean }[] = []) => ({
  checkedAt: '2026-10-15T12:00:00Z',
  overall: down.length ? 'DOWN' : 'UP',
  services: ['wallet-service', 'social-service'].map((name) => ({ name, status: down.includes(name) ? 'DOWN' : 'UP', error: down.includes(name) ? 'HTTP 503' : null })),
  queues: queues.map((q) => ({ ...q, messagesUnacked: 0, consumers: 1 })),
});

function build(results: Record<string, unknown>, opts: { errors?: string[]; llmFails?: boolean } = {}) {
  const clock = new FakeClock();
  const alerts = new MemAlerts();
  const runs = new MemRuns();
  const ids = new SeqIds();
  const raise = new RaiseAlertUseCase(alerts, clock, ids);
  const mcp = new FakeMcp(
    {
      get_service_health: health(),
      list_failed_sagas: { count: 0, byFailureReason: {}, items: [] },
      list_flagged_content: { totalPending: 0, oldestEnqueuedAt: null, items: [] },
      detect_anomalies: { modelVersion: 'x', anomalies: [] },
      raise_alert: async () => undefined,
      ...results,
    },
    new Set(opts.errors ?? []),
  );
  // `raise_alert` goes through the real use case, like the MCP server does
  (mcp as unknown as { callTool: unknown }).callTool = (async (name: string, args: Record<string, unknown>) => {
    if (name !== 'raise_alert') return FakeMcp.prototype.callTool.call(mcp, name, args);
    mcp.calls.push({ name, args });
    const r = await raise.execute({ severity: args.severity as never, kind: args.kind as never, message: args.message as string, details: args.details as never, dedupeKey: args.dedupeKey as string, source: 'MONITORING_AGENT' });
    const out = { alertId: r.alert.id, created: r.created, status: r.alert.status };
    return { content: JSON.stringify(out), isError: false, structured: out };
  }) as never;
  const llm = new ScriptedLlm(() => {
    if (opts.llmFails) throw new Error('llm down');
    return say('Explicación del hallazgo.');
  });
  const monitoring = new RunMonitoringUseCase(mcp, runs, alerts, new MemLocks(clock), llm, fakePrompts, clock, ids, silentLogger, {
    thresholds: DEFAULT_THRESHOLDS,
    anomalyMetrics: ['posts'],
    anomalyDays: 30,
    anomalySensitivity: 0.8,
    explain: true,
  });
  return { clock, alerts, runs, mcp, llm, monitoring };
}

const run = async (m: ReturnType<typeof build>, trigger: 'SCHEDULE' | 'MANUAL' = 'MANUAL') => {
  const started = await m.monitoring.start({ trigger, requestedBy: 'system' });
  await started?.done;
  return started;
};

describe('MonitoringAgent (UC-20)', () => {
  it('healthy platform: SUCCEEDED run, no alerts, no LLM calls, only read tools', async () => {
    const m = build({});
    const s = (await run(m))!;
    expect((await m.runs.findById(s.agentRunId))!.run).toMatchObject({ status: 'SUCCEEDED', stopReason: 'COMPLETED', agent: 'MONITORING', trigger: 'MANUAL' });
    expect(m.alerts.items.size).toBe(0);
    expect(m.llm.requests).toHaveLength(0);
    expect(m.mcp.calls.map((c) => c.name)).toEqual(['get_service_health', 'list_failed_sagas', 'list_failed_sagas', 'list_flagged_content', 'detect_anomalies']);
  });

  it('a down service raises SERVICE_DOWN/WARNING via raise_alert + an explanation from the LLM; the event goes to the outbox', async () => {
    const m = build({ get_service_health: health(['wallet-service']) });
    const s = (await run(m))!;
    const [alert] = [...m.alerts.items.values()];
    expect(alert).toMatchObject({ kind: 'SERVICE_DOWN', severity: 'WARNING', resource: 'wallet-service', source: 'MONITORING_AGENT', agentRunId: null, fingerprint: 'SERVICE_DOWN:wallet-service' });
    expect(alert!.explanation).toBe('Explicación del hallazgo.');
    expect(m.alerts.events.map((e) => e.type)).toEqual(['bandada.insights.alert.raised.v1']);
    expect((await m.runs.findById(s.agentRunId))!.run.alertIds).toEqual([alert!.id]);
    expect(m.mcp.calls.find((c) => c.name === 'raise_alert')!.args).toMatchObject({ dedupeKey: 'SERVICE_DOWN:wallet-service', severity: 'WARNING' });
  });

  it('dedupes by fingerprint, bumps occurrences and escalates to CRITICAL on the second consecutive failure (one event per escalation)', async () => {
    const m = build({ get_service_health: health(['wallet-service']) });
    await run(m);
    m.clock.advance(5 * 60_000);
    await run(m);
    m.clock.advance(5 * 60_000);
    await run(m);
    expect(m.alerts.items.size).toBe(1);
    const alert = [...m.alerts.items.values()][0]!;
    expect([alert.severity, alert.occurrences]).toEqual(['CRITICAL', 3]);
    expect(m.alerts.events).toHaveLength(2); // raised + escalated, not one per run
  });

  it('does not count a failing source tool as "quiet"; resolves after 3 quiet runs', async () => {
    const m = build({ get_service_health: health(['wallet-service']) });
    await run(m);
    const id = [...m.alerts.items.keys()][0]!;
    const internals = m.mcp as unknown as { results: Record<string, unknown>; errors: Set<string> };
    // get_service_health errors: the condition is unknown, so no progress towards resolution
    internals.errors.add('get_service_health');
    m.clock.advance(5 * 60_000);
    await run(m);
    expect(m.alerts.items.get(id)!.quietRuns).toBe(0);
    // healthy again: 3 consecutive quiet runs resolve it
    internals.errors.delete('get_service_health');
    internals.results.get_service_health = health();
    for (let i = 1; i <= 2; i++) {
      m.clock.advance(5 * 60_000);
      await run(m);
      expect(m.alerts.items.get(id)).toMatchObject({ quietRuns: i, status: 'OPEN' });
    }
    m.clock.advance(5 * 60_000);
    await run(m);
    expect(m.alerts.items.get(id)).toMatchObject({ status: 'RESOLVED', resolvedBy: 'SYSTEM' });
  });

  it('a failing tool skips its rules (never read as healthy) and the run still SUCCEEDS with the step recorded as error', async () => {
    const m = build({}, { errors: ['get_service_health'] });
    const s = (await run(m))!;
    const stored = (await m.runs.findById(s.agentRunId))!;
    expect(stored.run.status).toBe('SUCCEEDED');
    expect(stored.steps.find((x) => x.toolName === 'get_service_health')).toMatchObject({ isError: true });
    expect(m.alerts.items.size).toBe(0);
  });

  it('the alert is raised even if the LLM is down (explanation stays empty)', async () => {
    const m = build({ get_service_health: health(['social-service']) }, { llmFails: true });
    await run(m);
    const alert = [...m.alerts.items.values()][0]!;
    expect(alert.explanation).toBeNull();
    expect(alert.status).toBe('OPEN');
  });

  it('DLQ, saga and moderation findings map to their kinds', async () => {
    const m = build({
      get_service_health: health([], [{ name: 'events-service.saga-replies.dlq', messagesReady: 60, isDeadLetter: true }]),
      list_failed_sagas: (args: Record<string, unknown>) => (args.status === 'FAILED' ? { count: 2, byFailureReason: { TICKET_ISSUE_FAILED: 2 }, items: [] } : { count: 0, byFailureReason: {}, items: [] }),
      list_flagged_content: { totalPending: 25, oldestEnqueuedAt: '2026-10-15T08:00:00Z', items: [] },
      detect_anomalies: { modelVersion: 'x', anomalies: [{ metric: 'posts', at: '2026-10-10', value: 90, expected: 10, score: 0.95, direction: 'SPIKE' }] },
    });
    await run(m);
    const got = [...m.alerts.items.values()].map((a) => [a.kind, a.severity, a.resource]).sort();
    expect(got).toEqual([['DLQ_BACKLOG', 'CRITICAL', 'events-service.saga-replies.dlq'], ['METRIC_ANOMALY', 'INFO', 'posts'], ['MODERATION_BACKLOG', 'WARNING', 'moderation-queue'], ['SAGA_FAILURES', 'WARNING', 'saga-failed']].sort());
  });

  it('one run per 5-minute window and per lease: duplicates are skipped, a manual run returns the active run', async () => {
    const m = build({});
    const first = await m.monitoring.start({ trigger: 'SCHEDULE', requestedBy: 'system' });
    expect(first).not.toBeNull();
    // same window, second replica/tick
    expect(await m.monitoring.start({ trigger: 'SCHEDULE', requestedBy: 'system' })).toBeNull();
    // a manual request while the first is still running returns that run
    const manual = await m.monitoring.start({ trigger: 'MANUAL', requestedBy: 'admin' });
    expect(manual).toMatchObject({ agentRunId: first!.agentRunId, started: false });
    await first!.done;
    m.clock.advance(5 * 60_000);
    expect(await m.monitoring.start({ trigger: 'SCHEDULE', requestedBy: 'system' })).not.toBeNull();
  });
});

describe('RaiseAlert / AcknowledgeAlert', () => {
  const setup = () => {
    const clock = new FakeClock();
    const alerts = new MemAlerts();
    return { alerts, raise: new RaiseAlertUseCase(alerts, clock, new SeqIds()), ack: new AcknowledgeAlertUseCase(alerts, clock) };
  };
  it('REST callers without dedupeKey get a derived fingerprint (kind + authorId)', async () => {
    const { raise } = setup();
    const a = await raise.execute({ severity: 'WARNING', kind: 'MODERATION_ESCALATION', message: 'x', details: { authorId: 'u1' }, source: 'N8N' });
    const b = await raise.execute({ severity: 'WARNING', kind: 'MODERATION_ESCALATION', message: 'x', details: { authorId: 'u1' }, source: 'N8N' });
    expect([a.created, b.created, b.alert.occurrences]).toEqual([true, false, 2]);
  });
  it('ack is idempotent; unknown alert -> ALERT_NOT_FOUND; resolved -> ALERT_ALREADY_RESOLVED', async () => {
    const { alerts, raise, ack } = setup();
    const { alert } = await raise.execute({ severity: 'INFO', kind: 'METRIC_ANOMALY', message: 'm', dedupeKey: 'METRIC_ANOMALY:posts', source: 'MANUAL' });
    const one = await ack.execute({ alertId: alert.id, by: 'admin', note: 'visto' });
    const two = await ack.execute({ alertId: alert.id, by: 'other' });
    expect([one.status, two.acknowledgedBy, two.note]).toEqual(['ACKNOWLEDGED', 'admin', 'visto']);
    await expect(ack.execute({ alertId: 'nope', by: 'a' })).rejects.toMatchObject({ code: 'ALERT_NOT_FOUND' });
    await alerts.save({ ...newAlert({ id: 'r1', now: 'x', severity: 'INFO', kind: 'SERVICE_DOWN', message: 'm', source: 'MANUAL' }), status: 'RESOLVED' });
    await expect(ack.execute({ alertId: 'r1', by: 'a' })).rejects.toMatchObject({ code: 'ALERT_ALREADY_RESOLVED' });
  });
});
