import type { Locale } from './locale';
import type { ConcreteEngine, ReportEngine } from './report-engine';

export const REPORT_STATUSES = ['PENDING', 'RUNNING', 'READY', 'FAILED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export type DatasetColumnType = 'string' | 'integer' | 'number' | 'date' | 'datetime' | 'boolean';
export interface DatasetColumn {
  name: string;
  label?: string;
  type: DatasetColumnType;
}
export type DatasetCell = string | number | boolean | null;
export interface ReportDataset {
  columns: DatasetColumn[];
  rows: DatasetCell[][];
}

export interface GeneratedReport {
  id: string;
  title: string | null;
  question: string;
  locale: Locale;
  status: ReportStatus;
  requestedBy: string;
  agentRunId: string | null;
  /** What the admin asked for (AUTO by default). Reports stored before ADR-0022 have no value. */
  requestedEngine?: ReportEngine;
  /** Real engine and model that wrote the report (set when it finishes). */
  engine?: ConcreteEngine | null;
  model?: string | null;
  markdown: string | null;
  dataset: ReportDataset | null;
  datasetHash: string | null;
  chart: Record<string, unknown> | null;
  audioKey: string | null;
  audioMime: string | null;
  audioDurationSeconds: number | null;
  audioError: string | null;
  fidelityWarning: boolean;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

export function newReport(i: { id: string; question: string; locale: Locale; requestedBy: string; agentRunId: string; now: string; engine?: ReportEngine }): GeneratedReport {
  return {
    id: i.id,
    title: null,
    question: i.question,
    locale: i.locale,
    status: 'PENDING',
    requestedBy: i.requestedBy,
    agentRunId: i.agentRunId,
    requestedEngine: i.engine ?? 'AUTO',
    engine: null,
    model: null,
    markdown: null,
    dataset: null,
    datasetHash: null,
    chart: null,
    audioKey: null,
    audioMime: null,
    audioDurationSeconds: null,
    audioError: null,
    fidelityWarning: false,
    failureReason: null,
    createdAt: i.now,
    completedAt: null,
  };
}
