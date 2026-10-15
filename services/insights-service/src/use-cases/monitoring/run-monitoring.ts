import { type AgentRun, type AgentRunStatus, newAgentRun } from '../../entities/agent-run';
import { QUIET_RUNS_TO_RESOLVE, resolve } from '../../entities/alert';
import {
  anomalyFindings,
  type Finding,
  type HealthSnapshot,
  moderationFindings,
  type ModerationSnapshot,
  type MonitoringThresholds,
  queueFindings,
  sagaFindings,
  type SagaSnapshot,
  serviceDownFindings,
} from '../../entities/policies/monitoring-rules';
import type { LlmPort } from '../ports/llm.port';
import type { McpClientFactory, McpClientPort } from '../ports/mcp-client.port';
import type { AppLogger, Clock, IdGenerator, PromptCatalog } from '../ports/misc';
import type { AgentRunRepository, AlertRepository, LockPort } from '../ports/repositories';

const MIN = 60_000;
export const MAX_EXPLANATIONS_PER_RUN = 5;

export interface MonitoringOptions {
  thresholds: MonitoringThresholds;
  anomalyMetrics: string[];
  anomalyDays: number;
  anomalySensitivity: number;
  /** Ask the LLM to explain new alerts (never decides anything, A3). */
  explain: boolean;
}

export interface MonitoringStart {
  agentRunId: string;
  status: AgentRunStatus;
  /** False when an execution was already in progress and its id is returned. */
  started: boolean;
  /** Resolves when the run finished (the scheduler awaits it, the REST endpoint does not). */
  done: Promise<void>;
}

const windowKey = (d: Date) => `monitoring-window-${new Date(Math.floor(d.getTime() / (5 * MIN)) * 5 * MIN).toISOString().slice(0, 16)}`;

/** MonitoringAgent (UC-20): deterministic rules over MCP tool results; the LLM only phrases the explanation of an alert already decided. */
export class RunMonitoringUseCase {
  constructor(
    private readonly mcp: McpClientFactory,
    private readonly runs: AgentRunRepository,
    private readonly alerts: AlertRepository,
    private readonly locks: LockPort,
    private readonly llm: LlmPort,
    private readonly prompts: PromptCatalog,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly logger: AppLogger,
    private readonly options: MonitoringOptions,
  ) {}

  async start(input: { trigger: 'SCHEDULE' | 'MANUAL'; requestedBy: string }): Promise<MonitoringStart | null> {
    const now = this.clock.now();
    const runId = this.ids.next();
    if (input.trigger === 'SCHEDULE' && !(await this.locks.tryAcquire(windowKey(now), 10 * MIN, runId))) return null;
    if (!(await this.locks.tryAcquire('monitoring', 2 * MIN, runId))) {
      const holder = await this.locks.holder('monitoring');
      if (input.trigger === 'SCHEDULE' || !holder) return null;
      return { agentRunId: holder, status: 'RUNNING', started: false, done: Promise.resolve() };
    }
    const run = newAgentRun({ id: runId, agent: 'MONITORING', trigger: input.trigger, requestedBy: input.requestedBy, locale: 'es', now: now.toISOString(), promptVersion: this.prompts.version });
    try {
      await this.runs.create(run);
    } catch (error) {
      await this.locks.release('monitoring', runId);
      throw error;
    }
    const done = this.execute(run).finally(() => this.locks.release('monitoring', runId).catch(() => undefined));
    return { agentRunId: runId, status: 'RUNNING', started: true, done };
  }

  private async execute(run: AgentRun): Promise<void> {
    let client: McpClientPort | undefined;
    try {
      client = await this.mcp.create({ actorId: run.requestedBy, correlationId: run.id, agentRunId: run.id });
      const call = this.caller(run, client);
      const now = this.clock.now();
      const iso = (ms: number) => new Date(ms).toISOString();
      const day = (ms: number) => iso(ms).slice(0, 10);

      const health = await call<HealthSnapshot>('get_service_health', { includeQueues: true });
      const failed = await call<{ count: number; byFailureReason: Record<string, number> }>('list_failed_sagas', { status: 'FAILED', since: iso(now.getTime() - 15 * MIN), limit: 200 });
      const comp = await call<{ count: number }>('list_failed_sagas', { status: 'COMPENSATED', since: iso(now.getTime() - 60 * MIN), limit: 200 });
      const flagged = await call<ModerationSnapshot>('list_flagged_content', { source: 'ALL', limit: 50 });
      const yesterday = now.getTime() - 86_400_000;
      const anomalies = await call<{ anomalies: Parameters<typeof anomalyFindings>[0] }>('detect_anomalies', {
        metrics: this.options.anomalyMetrics,
        from: day(yesterday - this.options.anomalyDays * 86_400_000),
        to: day(yesterday),
        granularity: 'day',
        sensitivity: this.options.anomalySensitivity,
      });

      const active = await this.alerts.listActive();
      const previouslyOpen = new Set(active.filter((a) => a.source === 'MONITORING_AGENT').map((a) => a.fingerprint));
      const findings: Finding[] = [];
      const evaluated = new Set<string>();
      if (health) {
        findings.push(...serviceDownFindings(health, previouslyOpen), ...queueFindings(health, this.options.thresholds));
        evaluated.add('SERVICE_DOWN').add('DLQ_BACKLOG');
      }
      if (failed && comp) {
        const snap: SagaSnapshot = { failedRecent: failed.count, compensatedLastHour: comp.count, byFailureReason: failed.byFailureReason };
        findings.push(...sagaFindings(snap, this.options.thresholds));
        evaluated.add('SAGA_FAILURES');
      }
      if (flagged) {
        findings.push(...moderationFindings(flagged, now.getTime(), this.options.thresholds));
        evaluated.add('MODERATION_BACKLOG');
      }
      if (anomalies) {
        findings.push(...anomalyFindings(anomalies.anomalies));
        evaluated.add('METRIC_ANOMALY');
      }

      let explained = 0;
      const current = new Set<string>();
      for (const f of findings) {
        const dedupeKey = `${f.kind}:${f.resource}`;
        current.add(dedupeKey);
        const raised = await call<{ alertId: string; created: boolean; status: string }>('raise_alert', { severity: f.severity, kind: f.kind, message: f.message, details: f.details, dedupeKey });
        if (!raised) continue;
        if (!run.alertIds.includes(raised.alertId)) run.alertIds.push(raised.alertId);
        if (raised.created && this.options.explain && explained < MAX_EXPLANATIONS_PER_RUN) {
          explained += 1;
          await this.explain(run, raised.alertId, f);
        }
      }
      await this.autoResolve(active, evaluated, current);
      run.status = 'SUCCEEDED';
      run.stopReason = 'COMPLETED';
    } catch (error) {
      this.logger.error('monitoring run failed', { agentRunId: run.id, error: (error as Error).message });
      run.status = 'FAILED';
      run.stopReason = 'ERROR';
      run.error = { code: 'MONITORING_ERROR', message: (error as Error).message.slice(0, 300) };
    } finally {
      run.finishedAt = this.clock.now().toISOString();
      await this.runs.update(run).catch(() => undefined);
      await client?.close().catch(() => undefined);
    }
  }

  /** Calls an MCP tool from code, auditing the step in the run; returns null when the tool errored (the rule is then skipped, never read as "healthy"). */
  private caller(run: AgentRun, client: McpClientPort) {
    return async <T>(name: string, args: Record<string, unknown>): Promise<T | null> => {
      const t0 = this.clock.now();
      let isError = false;
      let text = '';
      let structured: unknown = null;
      try {
        const res = await client.callTool(name, args);
        isError = res.isError;
        text = res.content;
        structured = res.structured ?? (isError ? null : JSON.parse(res.content));
      } catch (error) {
        isError = true;
        text = (error as Error).message;
      }
      if (!run.toolsUsed.includes(name)) run.toolsUsed.push(name);
      run.stepCount += 1;
      await this.runs.appendStep(run.id, {
        index: run.stepCount,
        kind: 'TOOL_CALL',
        toolName: name,
        input: args,
        outputSummary: text.slice(0, 2000),
        isError,
        startedAt: t0.toISOString(),
        durationMs: this.clock.now().getTime() - t0.getTime(),
      });
      return isError ? null : (structured as T);
    };
  }

  private async explain(run: AgentRun, alertId: string, f: Finding): Promise<void> {
    try {
      const res = await this.llm.complete({
        tier: 'fast',
        purpose: 'explain_alert',
        locale: 'es',
        system: this.prompts.system('alert', 'es'),
        messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ kind: f.kind, severity: f.severity, resource: f.resource, message: f.message, details: f.details }) }] }],
        maxTokens: 400,
        effort: 'low',
      });
      run.llmSteps += 1;
      run.llmProvider = this.llm.provider;
      run.model = res.model;
      run.tokens.input += res.usage.inputTokens;
      run.tokens.output += res.usage.outputTokens;
      const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(' ').trim();
      const alert = await this.alerts.findById(alertId);
      if (alert && text) await this.alerts.save({ ...alert, explanation: text.slice(0, 1200) });
    } catch (error) {
      // the alert already exists; an explanation is optional (A3)
      this.logger.warn('alert explanation skipped', { alertId, error: (error as Error).message });
    }
  }

  /** Alerts raised by the agent whose condition was not seen for 3 consecutive runs become RESOLVED (resolvedBy SYSTEM). */
  private async autoResolve(active: Awaited<ReturnType<AlertRepository['listActive']>>, evaluated: Set<string>, current: Set<string>): Promise<void> {
    const now = this.clock.now().toISOString();
    for (const a of active) {
      if (a.source !== 'MONITORING_AGENT' || !evaluated.has(a.kind) || current.has(a.fingerprint)) continue;
      const quietRuns = a.quietRuns + 1;
      await this.alerts.save(quietRuns >= QUIET_RUNS_TO_RESOLVE ? { ...resolve(a, 'SYSTEM', now), quietRuns } : { ...a, quietRuns });
    }
  }
}
