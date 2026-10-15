import type { CommentProps } from '../../entities/comment.entity';
import { DomainError } from '../../entities/errors/domain-error';
import type { ContentReportProps, ReportReason, ReportTargetType } from '../../entities/content-report.entity';
import { shouldAutoHide } from '../../entities/policies/report.policy';
import { SocialEvents } from '../events';
import type { Clock, CommentRepository, EventPublisher, IdGenerator, PostRepository, ReportRepository, UnitOfWork } from '../ports';
import type { PostAccess } from '../posts/post-access';

export interface ReportContentInput {
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details?: string | null;
}

export class ReportContentUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly comments: CommentRepository,
    private readonly reports: ReportRepository,
    private readonly access: PostAccess,
    private readonly events: EventPublisher,
    private readonly uow: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly hideThreshold: number,
  ) {}

  async execute(input: ReportContentInput): Promise<ContentReportProps> {
    const target = await this.loadTarget(input);
    if (target.authorId === input.reporterId) throw new DomainError('CANNOT_REPORT_OWN_CONTENT');
    const now = this.clock.now();
    const report: ContentReportProps = {
      id: this.ids.next(),
      targetType: input.targetType,
      targetId: input.targetId,
      targetAuthorId: target.authorId,
      reporterId: input.reporterId,
      reason: input.reason,
      details: input.details?.trim() || null,
      status: 'OPEN',
      resolution: null,
      resolutionNote: null,
      resolvedBy: null,
      createdAt: now,
      resolvedAt: null,
    };

    await this.uow.run(async () => {
      await this.reports.insert(report);
      let autoHidden = false;
      let count = 1;
      if (input.targetType === 'POST') {
        count = (await this.posts.incrementOpenReports(input.targetId)) ?? 1;
        if (shouldAutoHide(count, this.hideThreshold)) {
          autoHidden = await this.posts.hideIfPublished(input.targetId, 'REPORTED', now);
          if (autoHidden) await this.events.publish(SocialEvents.postHidden(input.targetId, target.authorId, 'REPORTED', now));
        }
      } else {
        count = (await this.comments.incrementOpenReports(input.targetId)) ?? 1;
        if (shouldAutoHide(count, this.hideThreshold)) {
          autoHidden = await this.comments.hideIfVisible(input.targetId, now);
          if (autoHidden) await this.events.publish(SocialEvents.commentHidden(target.comment as CommentProps, 'HIDDEN', 'REPORTED', count, now));
        }
      }
      await this.events.publish(SocialEvents.contentReported(report, count, autoHidden, now));
    });
    return report;
  }

  private async loadTarget(input: ReportContentInput): Promise<{ authorId: string; comment?: CommentProps }> {
    if (input.targetType === 'POST') {
      const post = await this.posts.findById(input.targetId);
      if (!post || !(await this.access.canView(post, input.reporterId))) throw new DomainError('NOT_FOUND');
      return { authorId: post.authorId };
    }
    const comment = await this.comments.findById(input.targetId);
    if (!comment || comment.status === 'REMOVED') throw new DomainError('NOT_FOUND');
    const post = await this.posts.findById(comment.postId);
    if (!post || !(await this.access.canView(post, input.reporterId))) throw new DomainError('NOT_FOUND');
    return { authorId: comment.authorId, comment };
  }
}
