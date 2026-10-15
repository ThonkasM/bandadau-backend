import type { AgentKind, AgentRun, AgentRunStep } from '../../src/entities/agent-run';
import type { Alert, AlertSeverity, AlertStatus } from '../../src/entities/alert';
import type { MetricDelta, MetricName, MetricPoint } from '../../src/entities/metric-point';
import type { GeneratedReport, ReportStatus } from '../../src/entities/report';
import type { LlmPort, LlmRequest, LlmResponse, LlmToolDef } from '../../src/use-cases/ports/llm.port';
import type { McpClientFactory, McpClientPort, McpToolResult } from '../../src/use-cases/ports/mcp-client.port';
import type { AppLogger, AudioStorage, Clock, IdGenerator, JobRunner, OutboundMessage, PromptCatalog } from '../../src/use-cases/ports/misc';
import type { AgentRunRepository, AlertRepository, LockPort, MetricRepository, Page, ReportRepository } from '../../src/use-cases/ports/repositories';
import type { TtsPort, TtsResult } from '../../src/use-cases/ports/tts.port';

export class FakeClock implements Clock {
  constructor(public current = new Date('2026-10-15T12:00:00Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class SeqIds implements IdGenerator {
  private n = 0;
  next(): string {
    this.n += 1;
    return `00000000-0000-7000-8000-${String(this.n).padStart(12, '0')}`;
  }
}

export const silentLogger: AppLogger & { lines: { level: string; msg: string; ctx?: unknown }[] } = {
  lines: [],
  info(msg, ctx) {
    this.lines.push({ level: 'info', msg, ctx });
  },
  warn(msg, ctx) {
    this.lines.push({ level: 'warn', msg, ctx });
  },
  error(msg, ctx) {
    this.lines.push({ level: 'error', msg, ctx });
  },
};

export class InlineJobs implements JobRunner {
  readonly pending: Promise<void>[] = [];
  enqueue(_name: string, job: () => Promise<void>): void {
    this.pending.push(job().catch(() => undefined));
  }
  async drain(): Promise<void> {
    await Promise.all(this.pending);
  }
}

export class MemReports implements ReportRepository {
  readonly items = new Map<string, GeneratedReport>();
  readonly events: OutboundMessage[] = [];
  async save(r: GeneratedReport, messages: OutboundMessage[] = []): Promise<void> {
    this.items.set(r.id, structuredClone(r));
    this.events.push(...messages);
  }
  async findById(id: string) {
    const r = this.items.get(id);
    return r ? structuredClone(r) : null;
  }
  async list(q: { status?: ReportStatus; limit: number }): Promise<Page<GeneratedReport>> {
    const all = [...this.items.values()].filter((r) => !q.status || r.status === q.status);
    return { items: all.slice(0, q.limit), nextCursor: null };
  }
  async listUnfinished() {
    return [...this.items.values()].filter((r) => r.status === 'PENDING' || r.status === 'RUNNING');
  }
}

export class MemRuns implements AgentRunRepository {
  readonly runs = new Map<string, AgentRun>();
  readonly steps = new Map<string, AgentRunStep[]>();
  async create(run: AgentRun) {
    this.runs.set(run.id, structuredClone(run));
  }
  async update(run: AgentRun) {
    this.runs.set(run.id, structuredClone(run));
  }
  async appendStep(runId: string, step: AgentRunStep) {
    this.steps.set(runId, [...(this.steps.get(runId) ?? []), structuredClone(step)]);
  }
  async findById(id: string) {
    const run = this.runs.get(id);
    return run ? { run: structuredClone(run), steps: this.steps.get(id) ?? [] } : null;
  }
  async list(q: { agent?: AgentKind; limit: number }): Promise<Page<AgentRun>> {
    return { items: [...this.runs.values()].filter((r) => !q.agent || r.agent === q.agent).slice(0, q.limit), nextCursor: null };
  }
}

export class MemAlerts implements AlertRepository {
  readonly items = new Map<string, Alert>();
  readonly events: OutboundMessage[] = [];
  async save(a: Alert, messages: OutboundMessage[] = []) {
    this.items.set(a.id, structuredClone(a));
    this.events.push(...messages);
  }
  async findById(id: string) {
    const a = this.items.get(id);
    return a ? structuredClone(a) : null;
  }
  async listActive() {
    return [...this.items.values()].filter((a) => a.status !== 'RESOLVED').map((a) => structuredClone(a));
  }
  async findActiveByFingerprint(fp: string) {
    return (await this.listActive()).find((a) => a.fingerprint === fp) ?? null;
  }
  async countOpen() {
    return [...this.items.values()].filter((a) => a.status === 'OPEN').length;
  }
  async list(q: { status?: AlertStatus; severity?: AlertSeverity; limit: number }): Promise<Page<Alert>> {
    return { items: [...this.items.values()].filter((a) => (!q.status || a.status === q.status) && (!q.severity || a.severity === q.severity)).slice(0, q.limit), nextCursor: null };
  }
}

export class MemMetrics implements MetricRepository {
  readonly values = new Map<string, number>();
  async series(name: MetricName, from: string, to: string): Promise<MetricPoint[]> {
    return [...this.values.entries()]
      .filter(([k]) => k.startsWith(`${name}|`))
      .map(([k, value]) => ({ name, date: k.split('|')[1] as string, value }))
      .filter((p) => p.date >= from && p.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  async increment(deltas: MetricDelta[]) {
    for (const d of deltas) this.values.set(`${d.name}|${d.date}`, (this.values.get(`${d.name}|${d.date}`) ?? 0) + d.amount);
  }
  set(name: MetricName, date: string, value: number) {
    this.values.set(`${name}|${date}`, value);
  }
}

export class MemLocks implements LockPort {
  private readonly held = new Map<string, { owner: string; until: number }>();
  constructor(private readonly clock: Clock) {}
  async tryAcquire(name: string, ttlMs: number, owner: string) {
    const cur = this.held.get(name);
    if (cur && cur.until > this.clock.now().getTime()) return false;
    this.held.set(name, { owner, until: this.clock.now().getTime() + ttlMs });
    return true;
  }
  async holder(name: string) {
    const cur = this.held.get(name);
    return cur && cur.until > this.clock.now().getTime() ? cur.owner : null;
  }
  async release(name: string, owner: string) {
    if (this.held.get(name)?.owner === owner) this.held.delete(name);
  }
}

export class MemStorage implements AudioStorage {
  readonly objects = new Map<string, { body: Buffer; mime: string }>();
  async put(key: string, body: Buffer, mime: string) {
    this.objects.set(key, { body, mime });
  }
  async presignedUrl(key: string, ttl: number) {
    return `http://minio.test/${key}?ttl=${ttl}`;
  }
}

export class FakeTts implements TtsPort {
  readonly provider = 'fake';
  constructor(
    readonly enabled = true,
    private readonly fail = false,
  ) {}
  readonly spoken: string[] = [];
  async synthesize(text: string): Promise<TtsResult> {
    if (this.fail) throw new Error('tts down');
    this.spoken.push(text);
    return { audio: Buffer.from('ID3fake'), mime: 'audio/mpeg', durationSeconds: 42 };
  }
}

export const fakePrompts: PromptCatalog = {
  version: 'test@1',
  system: (agent, locale) => `system:${agent}:${locale}`,
  compose: (locale, q) => `compose:${locale}:${q}`,
  audio: (locale) => `audio:${locale}`,
};

export const TOOL_DEFS: LlmToolDef[] = ['get_platform_kpis', 'get_registration_stats', 'raise_alert', 'get_service_health', 'list_failed_sagas', 'list_flagged_content', 'detect_anomalies'].map((name) => ({
  name,
  description: name,
  inputSchema: { type: 'object' },
}));

/** MCP client double: answers by tool name with canned results (JSON-serialised like the real server). */
export class FakeMcp implements McpClientPort, McpClientFactory {
  readonly calls: { name: string; args: Record<string, unknown> }[] = [];
  closed = false;
  constructor(
    private readonly results: Record<string, unknown | ((args: Record<string, unknown>) => unknown)> = {},
    private readonly errors = new Set<string>(),
    private readonly tools: LlmToolDef[] = TOOL_DEFS,
  ) {}
  async create(): Promise<McpClientPort> {
    return this;
  }
  async listTools() {
    return this.tools;
  }
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    this.calls.push({ name, args });
    if (this.errors.has(name)) return { content: 'UPSTREAM_UNAVAILABLE: down', isError: true };
    const r = this.results[name];
    const value = typeof r === 'function' ? (r as (a: Record<string, unknown>) => unknown)(args) : r;
    if (value === undefined) return { content: 'TOOL_NOT_FOUND', isError: true };
    return { content: JSON.stringify(value), isError: false, structured: value };
  }
  async close() {
    this.closed = true;
  }
}

/** LLM double driven by a script of responses; records every request. */
export class ScriptedLlm implements LlmPort {
  readonly provider = 'scripted';
  readonly requests: LlmRequest[] = [];
  constructor(private readonly script: ((req: LlmRequest, n: number) => LlmResponse)[] | ((req: LlmRequest, n: number) => LlmResponse)) {}
  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(req);
    const n = this.requests.length - 1;
    const fn = Array.isArray(this.script) ? (this.script[Math.min(n, this.script.length - 1)] as (r: LlmRequest, i: number) => LlmResponse) : this.script;
    return fn(req, n);
  }
}

export const usage = (i = 100, o = 50) => ({ inputTokens: i, outputTokens: o, cacheReadTokens: 0, cacheWriteTokens: 0 });
export const toolUse = (...calls: { name: string; input?: Record<string, unknown> }[]): LlmResponse => ({
  stopReason: 'tool_use',
  content: calls.map((c, i) => ({ type: 'tool_use' as const, id: `t${i}`, name: c.name, input: c.input ?? {} })),
  usage: usage(),
  model: 'fake-model',
});
export const say = (text: string): LlmResponse => ({ stopReason: 'end_turn', content: [{ type: 'text', text }], usage: usage(), model: 'fake-model' });
