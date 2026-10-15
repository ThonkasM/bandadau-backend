import { ValidationError } from '../../entities/errors/domain-errors';
import { isLocale, type Locale } from '../../entities/locale';
import { maskPersonalData } from '../../entities/policies/number-fidelity';
import { newReport, type ReportDataset } from '../../entities/report';
import type { Clock, IdGenerator, JobRunner } from '../ports/misc';
import type { ReportRepository } from '../ports/repositories';
import type { TtsPort } from '../ports/tts.port';
import type { ReportFinalizer } from './report-finalizer';

export interface ExternalReportInput {
  title: string;
  question?: string;
  markdown: string;
  dataset?: ReportDataset;
  chart?: Record<string, unknown>;
  audioSummary?: string;
  locale?: string;
}

/** MCP `generate_report`: persists a report written by the caller (an LLM client), renders chart/audio asynchronously. */
export class SaveExternalReportUseCase {
  constructor(
    private readonly reports: ReportRepository,
    private readonly finalizer: ReportFinalizer,
    private readonly tts: TtsPort,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly jobs: JobRunner,
    private readonly defaultLocale: Locale,
    private readonly publicApiUrl: string,
  ) {}

  async execute(input: ExternalReportInput, requestedBy: string, agentRunId: string | null): Promise<{ reportId: string; status: 'RUNNING'; audioStatus: 'PENDING' | 'NONE'; url: string }> {
    if (input.locale !== undefined && !isLocale(input.locale)) throw new ValidationError('locale must be es or en');
    const locale = isLocale(input.locale) ? input.locale : this.defaultLocale;
    const id = this.ids.next();
    const base = newReport({ id, question: input.question ?? input.title, locale, requestedBy, agentRunId: agentRunId ?? '', now: this.clock.now().toISOString() });
    const report = { ...base, agentRunId, status: 'RUNNING' as const, title: input.title };
    await this.reports.save(report);
    const audio = Boolean(input.audioSummary) && this.tts.enabled;
    this.jobs.enqueue(`ext-report:${id}`, async () => {
      try {
        await this.finalizer.finish(report, {
          title: input.title,
          markdown: maskPersonalData(input.markdown),
          dataset: input.dataset ?? null,
          chartSpec: input.chart ?? null,
          audioScript: input.audioSummary ? maskPersonalData(input.audioSummary) : null,
        });
      } catch (error) {
        await this.finalizer.fail(report, (error as Error).message);
      }
    });
    return { reportId: id, status: 'RUNNING', audioStatus: audio ? 'PENDING' : 'NONE', url: `${this.publicApiUrl.replace(/\/$/, '')}/api/v1/insights/reports/${id}` };
  }
}
