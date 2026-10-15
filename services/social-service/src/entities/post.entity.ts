import { DomainError } from './errors/domain-error';
import { assertValidMediaCombination, mediaVerdict, type MediaAssetView, type MediaStatus } from './value-objects/media';
import { extractHashtags, normalizePostText } from './value-objects/post-text';

export type PostVisibility = 'PUBLIC' | 'FOLLOWERS' | 'GROUP';
export type PostStatus = 'PENDING_MEDIA' | 'PUBLISHED' | 'HIDDEN' | 'REMOVED';
export type ReactionType = 'LIKE' | 'HELPFUL' | 'FUNNY' | 'SUPPORT';
export type HiddenReason = 'MEDIA_FLAGGED' | 'REPORTED' | 'MODERATOR' | 'AUTHOR_SUSPENDED';

export const REACTION_TYPES: readonly ReactionType[] = ['LIKE', 'HELPFUL', 'FUNNY', 'SUPPORT'];

export type ReactionCounts = Record<'like' | 'helpful' | 'funny' | 'support', number>;
export const emptyReactionCounts = (): ReactionCounts => ({ like: 0, helpful: 0, funny: 0, support: 0 });
export const reactionKey = (type: ReactionType): keyof ReactionCounts => type.toLowerCase() as keyof ReactionCounts;

export interface PostProps {
  id: string;
  clientId: string;
  authorId: string;
  authorUniversityId: string | null;
  authorCareer: string | null;
  text: string;
  hashtags: string[];
  visibility: PostVisibility;
  groupId: string | null;
  status: PostStatus;
  hiddenReason: HiddenReason | null;
  hiddenAt: Date | null;
  mediaIds: string[];
  reactionCounts: ReactionCounts;
  commentsCount: number;
  openReportsCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewPost {
  id: string;
  clientId: string;
  authorId: string;
  authorUniversityId?: string | null;
  authorCareer?: string | null;
  text: string;
  visibility: PostVisibility;
  groupId?: string | null;
  mediaIds: string[];
  media: readonly MediaAssetView[];
}

export class Post {
  private constructor(private readonly props: PostProps) {}

  static restore(props: PostProps): Post {
    return new Post({ ...props, mediaIds: [...props.mediaIds], hashtags: [...props.hashtags], reactionCounts: { ...props.reactionCounts } });
  }

  /** Invariant 6: with media the post is PENDING_MEDIA until every asset is APPROVED. */
  static create(input: NewPost, now: Date): Post {
    const hasMedia = input.mediaIds.length > 0;
    if (input.visibility === 'GROUP' && !input.groupId) throw new DomainError('GROUP_REQUIRED');
    if (input.visibility !== 'GROUP' && input.groupId) throw new DomainError('VALIDATION_FAILED', { field: 'groupId', code: 'INVALID_VALUE' });
    assertValidMediaCombination(input.media.map((m) => m.kind));
    const text = normalizePostText(input.text, hasMedia);
    if (input.media.some((m) => m.ownerId !== input.authorId)) throw new DomainError('MEDIA_NOT_OWNED');
    if (input.media.some((m) => m.status === 'REJECTED')) throw new DomainError('MEDIA_REJECTED');
    const verdict = hasMedia ? mediaVerdict(input.media.map((m) => m.status)) : 'APPROVED';
    const status: PostStatus = verdict === 'APPROVED' ? 'PUBLISHED' : verdict === 'BLOCKED' ? 'HIDDEN' : 'PENDING_MEDIA';
    return new Post({
      id: input.id,
      clientId: input.clientId,
      authorId: input.authorId,
      authorUniversityId: input.authorUniversityId ?? null,
      authorCareer: input.authorCareer ?? null,
      text,
      hashtags: extractHashtags(text),
      visibility: input.visibility,
      groupId: input.groupId ?? null,
      status,
      hiddenReason: status === 'HIDDEN' ? 'MEDIA_FLAGGED' : null,
      hiddenAt: status === 'HIDDEN' ? now : null,
      mediaIds: [...input.mediaIds],
      reactionCounts: emptyReactionCounts(),
      commentsCount: 0,
      openReportsCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  get id(): string { return this.props.id; }
  get clientId(): string { return this.props.clientId; }
  get authorId(): string { return this.props.authorId; }
  get status(): PostStatus { return this.props.status; }
  get visibility(): PostVisibility { return this.props.visibility; }
  get groupId(): string | null { return this.props.groupId; }
  get mediaIds(): readonly string[] { return this.props.mediaIds; }
  get hashtags(): readonly string[] { return this.props.hashtags; }
  get hiddenReason(): HiddenReason | null { return this.props.hiddenReason; }
  get snapshot(): Readonly<PostProps> { return this.props; }

  get isInteractable(): boolean { return this.props.status === 'PUBLISHED'; }

  /**
   * Re-evaluates the post against the current status of its media. Returns the transition performed:
   * `published`, `hidden` or `null` when nothing changes. Only PENDING_MEDIA posts and posts hidden for flagged
   * media (a moderator may still approve them) are re-evaluated.
   */
  applyMediaStatuses(views: ReadonlyMap<string, Pick<MediaAssetView, 'ownerId' | 'status'>>, now: Date): 'published' | 'hidden' | null {
    const { status, hiddenReason } = this.props;
    const reevaluable = status === 'PENDING_MEDIA' || (status === 'HIDDEN' && hiddenReason === 'MEDIA_FLAGGED');
    if (!reevaluable) return null;
    const known = this.props.mediaIds.map((id) => views.get(id));
    if (known.some((v) => v && v.ownerId !== this.props.authorId)) return this.setHidden('MEDIA_FLAGGED', now) ? 'hidden' : null;
    const verdict = mediaVerdict(known.map((v): MediaStatus | undefined => v?.status));
    if (verdict === 'APPROVED') {
      this.props.status = 'PUBLISHED';
      this.props.hiddenReason = null;
      this.props.hiddenAt = null;
      this.props.updatedAt = now;
      return 'published';
    }
    if (verdict === 'BLOCKED') return this.setHidden('MEDIA_FLAGGED', now) ? 'hidden' : null;
    return null;
  }

  private setHidden(reason: HiddenReason, now: Date): boolean {
    if (this.props.status === 'HIDDEN' && this.props.hiddenReason === reason) return false;
    this.props.status = 'HIDDEN';
    this.props.hiddenReason = reason;
    this.props.hiddenAt = now;
    this.props.updatedAt = now;
    return true;
  }

  /** Moderator decision (UC-18). Returns false when nothing changed (idempotent). */
  moderate(target: 'PUBLISHED' | 'HIDDEN' | 'REMOVED', now: Date): boolean {
    const current = this.props.status;
    if (current === target) return false;
    if (current === 'REMOVED' || current === 'PENDING_MEDIA') throw new DomainError('INVALID_STATUS_TRANSITION', { from: current, to: target });
    if (target === 'HIDDEN') return this.setHidden('MODERATOR', now);
    this.props.status = target;
    this.props.hiddenReason = null;
    this.props.hiddenAt = null;
    this.props.updatedAt = now;
    return true;
  }

  /** A PENDING_MEDIA post whose assets never finished is hidden for review (sweeper). */
  hideForMediaTimeout(now: Date): boolean {
    if (this.props.status !== 'PENDING_MEDIA') return false;
    return this.setHidden('MEDIA_FLAGGED', now);
  }

  /** Author deletes the post: logical removal. False when already REMOVED. */
  deleteByAuthor(now: Date): boolean {
    if (this.props.status === 'REMOVED') return false;
    this.props.status = 'REMOVED';
    this.props.updatedAt = now;
    return true;
  }
}
