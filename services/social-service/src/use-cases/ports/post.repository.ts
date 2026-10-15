import type { Post, PostStatus, HiddenReason, ReactionType } from '../../entities/post.entity';
import type { KeysetCursor } from './pagination';

export const POST_REPOSITORY = Symbol('PostRepository');

export interface FeedQuery {
  userId: string;
  followingIds: readonly string[];
  groupIds: readonly string[];
  career: string | null;
  universityId: string | null;
  popularSince: Date;
  cursor: KeysetCursor | null;
  limit: number;
}

export interface PostRepository {
  findById(id: string): Promise<Post | null>;
  findByIds(ids: readonly string[]): Promise<Post[]>;
  findByAuthorAndClientId(authorId: string, clientId: string): Promise<Post | null>;
  /** Throws DomainError DUPLICATE_CLIENT_ID when `(authorId, clientId)` already exists. */
  insert(post: Post): Promise<void>;
  /** Persists status/hidden fields only if the stored status is still `expected` (optimistic). Returns whether it changed. */
  saveStatus(post: Post, expected: readonly PostStatus[]): Promise<boolean>;
  findByMediaId(mediaId: string): Promise<Post[]>;
  findPendingMedia(olderThan: Date, limit: number): Promise<Post[]>;
  listByStatus(status: PostStatus, cursor: KeysetCursor | null, limit: number): Promise<Post[]>;
  listGroupPosts(groupId: string, cursor: KeysetCursor | null, limit: number): Promise<Post[]>;
  findFeedPage(query: FeedQuery): Promise<Post[]>;
  countPublishedByAuthor(authorId: string): Promise<number>;
  incrementComments(postId: string, delta: number): Promise<void>;
  adjustReactionCounts(postId: string, change: { add?: ReactionType; remove?: ReactionType }): Promise<void>;
  /** Atomic `$inc`; returns the new count, or null when the post does not exist. */
  incrementOpenReports(postId: string): Promise<number | null>;
  /** Conditional update PUBLISHED -> HIDDEN. True only for the single caller that performs the transition. */
  hideIfPublished(postId: string, reason: HiddenReason, now: Date): Promise<boolean>;
  setOpenReports(postId: string, count: number): Promise<void>;
  /** Bulk HIDDEN by author suspension; returns the affected posts (id, mediaIds are not needed). */
  hidePublishedByAuthor(authorId: string, reason: HiddenReason, now: Date): Promise<Array<{ id: string; authorId: string }>>;
  restoreHiddenByAuthor(authorId: string, reason: HiddenReason, now: Date): Promise<number>;
}
