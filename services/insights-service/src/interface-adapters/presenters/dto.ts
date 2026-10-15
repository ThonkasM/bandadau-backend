import type { AgentRun, AgentRunStep } from '../../entities/agent-run';
import type { Alert } from '../../entities/alert';
import type { GeneratedReport } from '../../entities/report';

const iso = (v: string | null | undefined) => v ?? null;

export function toAlertDto(a: Alert) {
  return {
    id: a.id,
    severity: a.severity,
    kind: a.kind,
    message: a.message,
    details: a.details,
    status: a.status,
    source: a.source,
    agentRunId: a.agentRunId,
    raisedAt: a.raisedAt,
    acknowledgedAt: iso(a.acknowledgedAt),
    acknowledgedBy: a.acknowledgedBy,
    note: a.note,
    resource: a.resource,
    fingerprint: a.fingerprint,
    occurrences: a.occurrences,
    // extensions (not in the contract Alert schema, which allows additional properties)
    explanation: a.explanation,
    lastSeenAt: a.lastSeenAt,
  };
}

export function toReportSummaryDto(r: GeneratedReport) {
  return {
    id: r.id,
    title: r.title,
    question: r.question,
    locale: r.locale,
    status: r.status,
    requestedBy: r.requestedBy,
    agentRunId: r.agentRunId || null,
    hasAudio: r.audioKey !== null,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
  };
}

export function toReportDto(r: GeneratedReport, audioUrl: string | null) {
  return {
    ...toReportSummaryDto(r),
    markdown: r.markdown,
    dataset: r.dataset,
    chart: r.chart,
    audioUrl,
    audioDurationSeconds: r.audioDurationSeconds,
    failureReason: r.failureReason,
    // extensions
    datasetHash: r.datasetHash,
    fidelityWarning: r.fidelityWarning,
    audioError: r.audioError,
  };
}

export function toAgentRunSummaryDto(r: AgentRun) {
  return {
    id: r.id,
    agent: r.agent,
    trigger: r.trigger,
    status: r.status,
    model: r.model ?? undefined,
    toolsUsed: r.toolsUsed,
    tokens: { input: r.tokens.input, output: r.tokens.output, total: r.tokens.input + r.tokens.output },
    reportId: r.reportId,
    alertIds: r.alertIds,
    error: r.error ? `${r.error.code}: ${r.error.message}` : null,
    stopReason: r.stopReason,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    // extensions
    llmProvider: r.llmProvider,
    costUsdMicros: r.costUsdMicros,
    promptVersion: r.promptVersion,
    requestedBy: r.requestedBy,
  };
}

export function toAgentRunDto(r: AgentRun, steps: AgentRunStep[]) {
  return {
    ...toAgentRunSummaryDto(r),
    steps: steps.map((s) => ({
      index: s.index,
      kind: s.kind,
      toolName: s.toolName,
      input: s.input,
      outputSummary: s.outputSummary,
      isError: s.isError,
      startedAt: s.startedAt,
      durationMs: s.durationMs,
    })),
  };
}
