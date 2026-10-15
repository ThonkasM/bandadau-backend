export type ReportTargetType = 'POST' | 'COMMENT';
export type ReportReason = 'SPAM' | 'HARASSMENT' | 'NSFW' | 'VIOLENCE' | 'MISINFORMATION' | 'OTHER';
export type ReportStatus = 'OPEN' | 'RESOLVED_KEPT' | 'RESOLVED_REMOVED';
export type ReportResolution = 'KEEP' | 'REMOVE';

export interface ContentReportProps {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  targetAuthorId: string;
  reporterId: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  resolution: ReportResolution | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export const resolvedStatusFor = (resolution: ReportResolution): ReportStatus => (resolution === 'REMOVE' ? 'RESOLVED_REMOVED' : 'RESOLVED_KEPT');
