import { newAgentRun } from '../../entities/agent-run';
import { ValidationError } from '../../entities/errors/domain-errors';
import { isLocale, type Locale } from '../../entities/locale';
import { newReport } from '../../entities/report';
import type { AppLogger, Clock, IdGenerator, JobRunner, PromptCatalog } from '../ports/misc';
import type { AgentRunRepository, ReportRepository } from '../ports/repositories';

export interface RequestReportInput {
  question: string;
  locale?: string | undefined;
  /** `<uuid>` of the admin, or `system:<clientId>` for service callers (n8n). */
  requestedBy: string;
  defaultLocale: Locale;
  /** Agent kind of the run: EXTERNAL_MCP when an MCP client asked for it. */
  external?: boolean;
}
export interface RequestReportResult {
  reportId: string;
  agentRunId: string;
  status: 'PENDING';
  locale: Locale;
}

/** RequestReport (UC-19): records PENDING report + RUNNING agent run, answers 202 and hands the work to the ReportAgent. */
export class RequestReportUseCase {
  constructor(
    private readonly reports: ReportRepository,
    private readonly runs: AgentRunRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly jobs: JobRunner,
    private readonly prompts: PromptCatalog,
    private readonly logger: AppLogger,
    private readonly generate: (reportId: string) => Promise<void>,
  ) {}

  async execute(input: RequestReportInput): Promise<RequestReportResult> {
    const question = (input.question ?? '').trim();
    const errors: { field: string; code: string; message: string }[] = [];
    if (question.length < 10 || question.length > 1000) errors.push({ field: '/question', code: 'OUT_OF_RANGE', message: 'question must have between 10 and 1000 characters' });
    if (input.locale !== undefined && !isLocale(input.locale)) errors.push({ field: '/locale', code: 'INVALID_VALUE', message: 'locale must be es or en' });
    if (errors.length > 0) throw new ValidationError('Invalid report request', errors);
    const locale = isLocale(input.locale) ? input.locale : input.defaultLocale;

    const now = this.clock.now().toISOString();
    const reportId = this.ids.next();
    const runId = this.ids.next();
    const run = newAgentRun({
      id: runId,
      agent: input.external ? 'EXTERNAL_MCP' : 'REPORT',
      trigger: 'REPORT_REQUEST',
      requestedBy: input.requestedBy,
      locale,
      now,
      reportId,
      promptVersion: this.prompts.version,
    });
    await this.runs.create(run);
    await this.reports.save(newReport({ id: reportId, question, locale, requestedBy: input.requestedBy, agentRunId: runId, now }));
    this.jobs.enqueue(`report:${reportId}`, () => this.generate(reportId));
    this.logger.info('report requested', { reportId, agentRunId: runId, locale, requestedBy: input.requestedBy });
    return { reportId, agentRunId: runId, status: 'PENDING', locale };
  }
}
