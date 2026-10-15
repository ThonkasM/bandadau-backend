import type { CommentProps } from '../../entities/comment.entity';
import { resolvedStatusFor, type ContentReportProps, type ReportResolution, type ReportStatus } from '../../entities/content-report.entity';
import { DomainError } from '../../entities/errors/domain-error';
import type { Post, PostStatus } from '../../entities/post.entity';
import { SocialEvents } from '../events';
import type { PostOutput } from '../outputs';
import { paginate } from '../paginate';
import type { Clock, CommentRepository, EventPublisher, KeysetCursor, Page, PostRepository, ReportRepository, UnitOfWork } from '../ports';
import { DEFAULT_LIMIT } from '../ports';
import type { PostAssembler } from '../posts/post-assembler';

export interface ModerationPostOutput {
  output: PostOutput;
  reportsCount: number;
  hiddenReason: string | null;
}

export class ListPostsByStatusUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly assembler: PostAssembler,
  ) {}

  async execute(input: { status: PostStatus; cursor: KeysetCursor | null; limit?: number }): Promise<Page<ModerationPostOutput>> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const rows = await this.posts.listByStatus(input.status, input.cursor, limit + 1);
    const page = paginate(rows, limit, (p) => ({ createdAt: p.snapshot.createdAt, id: p.id }));
    const outputs = await this.assembler.assemble(page.items, null);
    return {
      items: outputs.map((output) => ({ output, reportsCount: output.post.openReportsCount, hiddenReason: output.post.hiddenReason })),
      nextCursor: page.nextCursor,
    };
  }
}

export class UpdatePostStatusUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly assembler: PostAssembler,
    private readonly events: EventPublisher,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: { postId: string; status: 'PUBLISHED' | 'HIDDEN' | 'REMOVED'; reason: string; actorId: string }): Promise<PostOutput> {
    const post = await this.posts.findById(input.postId);
    if (!post) throw new DomainError('NOT_FOUND');
    const previous = post.status;
    const now = this.clock.now();
    if (post.moderate(input.status, now)) {
      await this.uow.run(async () => {
        if (!(await this.posts.saveStatus(post, [previous]))) throw new DomainError('INVALID_STATUS_TRANSITION');
        if (input.status === 'HIDDEN') await this.events.publish(SocialEvents.postHidden(post.id, post.authorId, 'MODERATOR', now));
        else if (input.status === 'PUBLISHED') await this.events.publish(SocialEvents.postPublished(post, now));
        else await this.events.publish(SocialEvents.postRemoved(post, input.actorId, null, input.reason, now));
      });
    }
    const [output] = await this.assembler.assemble([post], null);
    return output as PostOutput;
  }
}

export class ListContentReportsUseCase {
  constructor(private readonly reports: ReportRepository) {}

  async execute(input: { status: ReportStatus; cursor: KeysetCursor | null; limit?: number }): Promise<Page<ContentReportProps>> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const rows = await this.reports.listByStatus(input.status, input.cursor, limit + 1);
    return paginate(rows, limit, (r) => ({ createdAt: r.createdAt, id: r.id }));
  }
}

export class ResolveContentReportUseCase {
  constructor(
    private readonly reports: ReportRepository,
    private readonly posts: PostRepository,
    private readonly comments: CommentRepository,
    private readonly events: EventPublisher,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  /** Resolves every OPEN report of the same content. Idempotent: an already resolved report is returned as is. */
  async execute(input: { reportId: string; resolution: ReportResolution; note?: string | null; actorId: string }): Promise<ContentReportProps> {
    const report = await this.reports.findById(input.reportId);
    if (!report) throw new DomainError('NOT_FOUND');
    if (report.status !== 'OPEN') return report;
    const now = this.clock.now();
    const note = input.note?.trim() || null;

    await this.uow.run(async () => {
      const resolved = await this.reports.resolveOpenForTarget(report.targetType, report.targetId, { resolution: input.resolution, note, actorId: input.actorId }, now);
      if (resolved.length === 0) return;
      if (report.targetType === 'POST') await this.applyToPost(report, input.resolution, note, input.actorId, now);
      else await this.applyToComment(report, input.resolution, now);
    });
    return { ...report, status: resolvedStatusFor(input.resolution), resolution: input.resolution, resolutionNote: note, resolvedBy: input.actorId, resolvedAt: now };
  }

  private async applyToPost(report: ContentReportProps, resolution: ReportResolution, note: string | null, actorId: string, now: Date): Promise<void> {
    const post: Post | null = await this.posts.findById(report.targetId);
    if (!post) return;
    const previous = post.status;
    if (resolution === 'REMOVE') {
      let changed = false;
      try {
        changed = post.moderate('REMOVED', now);
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
      }
      if (changed && (await this.posts.saveStatus(post, [previous]))) {
        await this.events.publish(SocialEvents.postRemoved(post, actorId, report.id, note, now));
      }
    } else if (previous === 'HIDDEN' && post.hiddenReason === 'REPORTED') {
      if (post.moderate('PUBLISHED', now)) await this.posts.saveStatus(post, [previous]);
    }
    await this.posts.setOpenReports(post.id, 0);
  }

  private async applyToComment(report: ContentReportProps, resolution: ReportResolution, now: Date): Promise<void> {
    const comment: CommentProps | null = await this.comments.findById(report.targetId);
    if (!comment) return;
    if (resolution === 'REMOVE') {
      if (comment.status !== 'REMOVED' && (await this.comments.setStatus(comment.id, 'REMOVED', now))) {
        await this.events.publish(SocialEvents.commentHidden(comment, 'REMOVED', 'MODERATOR', 0, now));
      }
    } else if (comment.status === 'HIDDEN') {
      await this.comments.setStatus(comment.id, 'VISIBLE', now);
    }
    await this.comments.setOpenReports(comment.id, 0);
  }
}
