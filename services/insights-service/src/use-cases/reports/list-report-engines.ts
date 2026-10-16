import type { ReportEngineInfo } from '../../entities/report-engine';
import type { LlmEnginesPort } from '../ports/llm-engines.port';

/** ListReportEngines: engines the agent may use, with current availability (never keys or URLs). */
export class ListReportEnginesUseCase {
  constructor(private readonly engines: LlmEnginesPort) {}

  execute(): Promise<ReportEngineInfo[]> {
    return this.engines.list();
  }
}
