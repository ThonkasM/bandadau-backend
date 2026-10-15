import type { CommentProps, CommentStatus } from '../../entities/comment.entity';
import type { KeysetCursor } from './pagination';

export const COMMENT_REPOSITORY = Symbol('CommentRepository');

export interface CommentRepository {
  insert(comment: CommentProps): Promise<void>;
  findById(id: string): Promise<CommentProps | null>;
  /** VISIBLE comments, plus HIDDEN ones authored by `viewerId`, oldest first. The cursor orders ascending. */
  list(postId: string, viewerId: string, cursor: KeysetCursor | null, limit: number): Promise<CommentProps[]>;
  incrementReplyCount(parentId: string): Promise<void>;
  incrementOpenReports(commentId: string): Promise<number | null>;
  hideIfVisible(commentId: string, now: Date): Promise<boolean>;
  setStatus(commentId: string, status: CommentStatus, now: Date): Promise<boolean>;
  setOpenReports(commentId: string, count: number): Promise<void>;
  hideVisibleByAuthor(authorId: string): Promise<number>;
  restoreHiddenByAuthor(authorId: string): Promise<number>;
}
