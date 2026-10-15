import type { ContentReportProps, ReportResolution, ReportStatus, ReportTargetType } from '../../entities/content-report.entity';
import type { KeysetCursor } from './pagination';

export const REPORT_REPOSITORY = Symbol('ReportRepository');

export interface ReportRepository {
  /** Throws DomainError ALREADY_REPORTED on the unique `(targetType, targetId, reporterId)`. */
  insert(report: ContentReportProps): Promise<void>;
  findById(id: string): Promise<ContentReportProps | null>;
  /** Oldest first. */
  listByStatus(status: ReportStatus, cursor: KeysetCursor | null, limit: number): Promise<ContentReportProps[]>;
  /** Resolves every OPEN report of the target; returns the reports that were resolved now. */
  resolveOpenForTarget(
    type: ReportTargetType,
    targetId: string,
    change: { resolution: ReportResolution; note: string | null; actorId: string },
    now: Date,
  ): Promise<ContentReportProps[]>;
}
