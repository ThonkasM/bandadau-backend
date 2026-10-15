import { acknowledge, fingerprintOf, newAlert, QUIET_RUNS_TO_RESOLVE, recordOccurrence, resolve } from '../../../src/entities/alert';
import { AgentStepLimitError } from '../../../src/entities/errors/domain-errors';
import { emptyUsage } from '../../../src/entities/agent-run';
import { assertBudget, costMicros, REPORT_GUARDRAILS } from '../../../src/entities/policies/agent-guardrails';
import { buildChartSpec, canonicalJson, specHasNoStyling } from '../../../src/entities/policies/chart-spec';
import {
  anomalyFindings,
  DEFAULT_THRESHOLDS,
  moderationFindings,
  queueFindings,
  sagaFindings,
  serviceDownFindings,
} from '../../../src/entities/policies/monitoring-rules';
import { checkNumberFidelity, extractNumbers, maskPersonalData, parseNumber } from '../../../src/entities/policies/number-fidelity';
import { detectStatisticalAnomalies } from '../../../src/entities/policies/stat-anomaly';

describe('monitoring rules (deterministic, A3)', () => {
  const health = (services: { name: string; status: 'UP' | 'DOWN' }[], queues: { name: string; ready: number; dlq: boolean }[] = []) => ({
    services: services.map((s) => ({ ...s, error: s.status === 'DOWN' ? 'HTTP 503' : null })),
    queues: queues.map((q) => ({ name: q.name, messagesReady: q.ready, messagesUnacked: 0, consumers: 1, isDeadLetter: q.dlq })),
  });

  it('flags a down service as WARNING the first time and CRITICAL when it was already open (2 consecutive runs)', () => {
    const h = health([{ name: 'wallet-service', status: 'DOWN' }, { name: 'social-service', status: 'UP' }]);
    expect(serviceDownFindings(h, new Set())).toEqual([expect.objectContaining({ kind: 'SERVICE_DOWN', severity: 'WARNING', resource: 'wallet-service' })]);
    expect(serviceDownFindings(h, new Set(['SERVICE_DOWN:wallet-service']))[0]?.severity).toBe('CRITICAL');
  });

  it('DLQ backlog: WARNING above 0, CRITICAL above 50; ordinary queue only above 1000', () => {
    const f = queueFindings(health([], [{ name: 'a.dlq', ready: 3, dlq: true }, { name: 'b.dlq', ready: 51, dlq: true }, { name: 'c.dlq', ready: 0, dlq: true }, { name: 'q1', ready: 1001, dlq: false }, { name: 'q2', ready: 1000, dlq: false }]), DEFAULT_THRESHOLDS);
    expect(f.map((x) => [x.resource, x.severity])).toEqual([['a.dlq', 'WARNING'], ['b.dlq', 'CRITICAL'], ['q1', 'WARNING']]);
  });

  it('saga failures: >=1 failed is WARNING, >=5 CRITICAL; >10 compensated in 1 h is WARNING', () => {
    expect(sagaFindings({ failedRecent: 0, compensatedLastHour: 10, byFailureReason: {} }, DEFAULT_THRESHOLDS)).toEqual([]);
    expect(sagaFindings({ failedRecent: 1, compensatedLastHour: 0, byFailureReason: {} }, DEFAULT_THRESHOLDS)[0]?.severity).toBe('WARNING');
    expect(sagaFindings({ failedRecent: 5, compensatedLastHour: 11, byFailureReason: {} }, DEFAULT_THRESHOLDS).map((f) => f.severity)).toEqual(['CRITICAL', 'WARNING']);
  });

  it('moderation backlog needs >20 pending AND age >2 h; >24 h is CRITICAL', () => {
    const now = Date.parse('2026-10-15T12:00:00Z');
    const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
    expect(moderationFindings({ totalPending: 20, oldestEnqueuedAt: at(5) }, now, DEFAULT_THRESHOLDS)).toEqual([]);
    expect(moderationFindings({ totalPending: 21, oldestEnqueuedAt: at(1) }, now, DEFAULT_THRESHOLDS)).toEqual([]);
    expect(moderationFindings({ totalPending: 21, oldestEnqueuedAt: at(3) }, now, DEFAULT_THRESHOLDS)[0]?.severity).toBe('WARNING');
    expect(moderationFindings({ totalPending: 30, oldestEnqueuedAt: at(25) }, now, DEFAULT_THRESHOLDS)[0]?.severity).toBe('CRITICAL');
  });

  it('anomalies are INFO, except a drop to zero of registrations which is WARNING', () => {
    const f = anomalyFindings([
      { metric: 'posts', at: '2026-10-10', value: 90, expected: 10, score: 0.9, direction: 'SPIKE' },
      { metric: 'registrationsConfirmed', at: '2026-10-11', value: 0, expected: 12, score: 0.9, direction: 'DROP' },
    ]);
    expect(f.map((x) => x.severity)).toEqual(['INFO', 'WARNING']);
  });
});

describe('alert lifecycle', () => {
  const base = () => newAlert({ id: 'a1', now: '2026-10-15T12:00:00Z', severity: 'WARNING', kind: 'SERVICE_DOWN', message: 'down', source: 'MONITORING_AGENT', resource: 'wallet-service' });

  it('derives the fingerprint kind:resource and starts OPEN with one occurrence', () => {
    const a = base();
    expect(a.fingerprint).toBe(fingerprintOf('SERVICE_DOWN', 'wallet-service'));
    expect([a.status, a.occurrences]).toEqual(['OPEN', 1]);
  });
  it('severity only escalates, never decreases; occurrences accumulate', () => {
    const a = base();
    const up = recordOccurrence(a, 'CRITICAL', '2026-10-15T12:05:00Z');
    expect([up.escalated, up.alert.severity, up.alert.occurrences]).toEqual([true, 'CRITICAL', 2]);
    const down = recordOccurrence(up.alert, 'INFO', '2026-10-15T12:10:00Z');
    expect([down.escalated, down.alert.severity, down.alert.occurrences]).toEqual([false, 'CRITICAL', 3]);
  });
  it('acknowledge is idempotent and resolve marks SYSTEM', () => {
    const a = acknowledge(base(), 'admin', '2026-10-15T12:01:00Z', 'looking');
    expect(acknowledge(a, 'other', '2026-10-15T12:02:00Z').acknowledgedBy).toBe('admin');
    expect(resolve(a, 'SYSTEM', '2026-10-15T12:30:00Z')).toEqual(expect.objectContaining({ status: 'RESOLVED', resolvedBy: 'SYSTEM' }));
    expect(QUIET_RUNS_TO_RESOLVE).toBe(3);
  });
});

describe('guardrails', () => {
  const state = (over: Partial<Parameters<typeof assertBudget>[1]> = {}) => ({ llmSteps: 0, toolCalls: 0, tokens: emptyUsage(), startedAtMs: 0, ...over });
  const limits = REPORT_GUARDRAILS(8, 1000);
  it('stops at 8 LLM steps, token budget, tool calls and time', () => {
    expect(() => assertBudget(limits, state({ llmSteps: 7 }), 1)).not.toThrow();
    expect(() => assertBudget(limits, state({ llmSteps: 8 }), 1)).toThrow(AgentStepLimitError);
    expect(() => assertBudget(limits, state({ tokens: { input: 900, output: 100, cacheRead: 0, cacheWrite: 0 } }), 1)).toThrow(/MAX_TOKENS/);
    expect(() => assertBudget(limits, state({ toolCalls: 16 }), 1)).toThrow(/MAX_TOOL_CALLS/);
    expect(() => assertBudget(limits, state(), 121_000)).toThrow(/TIMEOUT/);
  });
  it('cost is an integer number of micro-dollars', () => {
    const c = costMicros({ input: 31_200, output: 2_900, cacheRead: 0, cacheWrite: 0 }, 2, 10);
    expect(Number.isInteger(c)).toBe(true);
    expect(c).toBe(31_200 * 2 + 2_900 * 10);
  });
});

describe('number fidelity (A2)', () => {
  const dataset = { columns: [{ name: 'month', type: 'string' as const }, { name: 'confirmed', type: 'integer' as const }], rows: [['2026-08', 930], ['2026-09', 1284]] };
  it('parses es/en formats', () => {
    expect(parseNumber('1 284')).toBe(1284);
    expect(parseNumber('1.284')).toBe(1284);
    expect(parseNumber('1,284')).toBe(1284);
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber('1.284,50')).toBe(1284.5);
    expect(extractNumbers('Del 2026-09-01 al 15/10/2026 hubo 1 284 inscripciones y 12,5 por día')).toEqual([1284, 12.5]);
  });
  it('accepts figures that are in the dataset, a column sum, or a tool result', () => {
    expect(checkNumberFidelity('En septiembre hubo 1284 inscripciones y 930 en agosto; total 2214.', dataset, []).ok).toBe(true);
    expect(checkNumberFidelity('Hubo 77 créditos.', null, [{ totals: { credits: 77 } }]).ok).toBe(true);
  });
  it('tolerates 1 % rounding but rejects invented figures', () => {
    expect(checkNumberFidelity('Hubo 1290 inscripciones.', dataset, []).ok).toBe(true);
    const bad = checkNumberFidelity('Hubo 5000 inscripciones.', dataset, []);
    expect(bad.ok).toBe(false);
    expect(bad.unsupported).toEqual([5000]);
  });
  it('masks emails and UUIDs in generated text', () => {
    expect(maskPersonalData('Escribe a lucia@umsa.edu.bo sobre 01a13db2-c507-7f39-abfa-4388854ecb66')).toBe('Escribe a [email] sobre [id]');
  });
});

describe('chart spec (D13: no colors)', () => {
  const ds = { columns: [{ name: 'date', label: 'Fecha', type: 'date' as const }, { name: 'confirmed', label: 'Confirmadas', type: 'integer' as const }], rows: [['2026-10-01', 3], ['2026-10-02', 5]] };
  it('builds a Vega-Lite v5 spec from the intent and the dataset columns, with no styling', () => {
    const spec = buildChartSpec({ type: 'line', x: 'date', y: 'confirmed', title: 'Inscripciones' }, ds) as Record<string, any>;
    expect(spec.$schema).toBe('https://vega.github.io/schema/vega-lite/v5.json');
    expect(spec.data).toEqual({ name: 'dataset' });
    expect(spec.encoding.x).toEqual({ field: 'date', type: 'temporal', title: 'Fecha' });
    expect(specHasNoStyling(spec)).toBe(true);
  });
  it('rejects intents that reference unknown columns, table intents and big pies', () => {
    expect(buildChartSpec({ type: 'bar', x: 'nope', y: 'confirmed' }, ds)).toBeNull();
    expect(buildChartSpec({ type: 'table' }, ds)).toBeNull();
    const pie = { columns: ds.columns, rows: Array.from({ length: 7 }, (_, i) => [`c${i}`, i]) };
    expect(buildChartSpec({ type: 'arc', x: 'date', y: 'confirmed' }, pie)).toBeNull();
  });
  it('detects styling and canonicalises JSON with sorted keys', () => {
    expect(specHasNoStyling({ mark: { type: 'bar', color: '#ff0000' } })).toBe(false);
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });
});

describe('statistical anomaly detector', () => {
  const series = (vals: number[]) => vals.map((value, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, value }));
  it('flags a spike and a drop but not normal noise', () => {
    const out = detectStatisticalAnomalies(series([10, 11, 9, 10, 12, 10, 95, 11, 10, 0]), 0.7);
    expect(out.map((a) => [a.at, a.direction])).toEqual([['2026-10-07', 'SPIKE'], ['2026-10-10', 'DROP']]);
    expect(out[0]?.score).toBeGreaterThan(0.9);
  });
  it('needs at least 7 points and returns nothing for flat or tiny series', () => {
    expect(detectStatisticalAnomalies(series([1, 2, 100]), 0.5)).toEqual([]);
    expect(detectStatisticalAnomalies(series([5, 5, 5, 5, 5, 5, 5, 5]), 0.5)).toEqual([]);
  });
  it('sensitivity raises the bar', () => {
    const s = series([10, 11, 9, 10, 12, 10, 24, 11]);
    expect(detectStatisticalAnomalies(s, 0.5).length).toBeGreaterThanOrEqual(detectStatisticalAnomalies(s, 0.99).length);
  });
});
