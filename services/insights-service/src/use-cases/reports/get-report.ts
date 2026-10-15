import { ReportNotFoundError } from '../../entities/errors/domain-errors';
import type { GeneratedReport, ReportStatus } from '../../entities/report';
import type { AudioStorage } from '../ports/misc';
import type { Page, ReportRepository } from '../ports/repositories';

export const AUDIO_URL_TTL_SECONDS = 900;

export class GetReportUseCase {
  constructor(
    private readonly reports: ReportRepository,
    private readonly storage: AudioStorage,
  ) {}

  async execute(id: string): Promise<{ report: GeneratedReport; audioUrl: string | null }> {
    const report = await this.reports.findById(id);
    if (!report) throw new ReportNotFoundError();
    const audioUrl = report.audioKey ? await this.storage.presignedUrl(report.audioKey, AUDIO_URL_TTL_SECONDS) : null;
    return { report, audioUrl };
  }
}

export class ListReportsUseCase {
  constructor(private readonly reports: ReportRepository) {}
  execute(q: { status?: ReportStatus; cursor?: string; limit: number }): Promise<Page<GeneratedReport>> {
    return this.reports.list(q);
  }
}
