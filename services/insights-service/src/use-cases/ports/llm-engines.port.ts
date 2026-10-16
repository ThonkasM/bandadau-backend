import type { ReportEngine, ReportEngineInfo } from '../../entities/report-engine';
import type { LlmPort } from './llm.port';

/** Registry of report engines (Strategy + fallback chain). `select` builds a per-request `LlmPort` that applies the chain. */
export interface LlmEnginesPort {
  select(engine: ReportEngine, locale?: 'es' | 'en'): LlmPort;
  list(): Promise<ReportEngineInfo[]>;
}
export const LLM_ENGINES = Symbol('LlmEngines');
