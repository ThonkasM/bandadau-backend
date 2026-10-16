/** Engine that runs the report agent (ADR-0022). `AUTO` = first available of the configured chain; never stored as the real engine. */
export const REPORT_ENGINES = ['AUTO', 'OPENCODE', 'OLLAMA', 'STUB'] as const;
export type ReportEngine = (typeof REPORT_ENGINES)[number];
export type ConcreteEngine = Exclude<ReportEngine, 'AUTO'>;
/** AGENT: native tool-calling loop. HYBRID: deterministic planner + the model only words the answer. DETERMINISTIC: no model. */
export type EngineMode = 'AGENT' | 'HYBRID' | 'DETERMINISTIC';

export const isReportEngine = (v: unknown): v is ReportEngine => typeof v === 'string' && (REPORT_ENGINES as readonly string[]).includes(v);

/** What the panel may know about an engine. It never carries keys or URLs. */
export interface ReportEngineInfo {
  engine: ConcreteEngine;
  label: string;
  model: string | null;
  available: boolean;
  /** Data leaves the platform towards a third party (people names are pseudonymized first). */
  external: boolean;
  mode: EngineMode;
}
