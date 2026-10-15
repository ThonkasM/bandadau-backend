import { DomainError } from './errors/domain-error';

export type CommentStatus = 'VISIBLE' | 'HIDDEN' | 'REMOVED';
export const COMMENT_MAX = 500;

export interface CommentProps {
  id: string;
  postId: string;
  authorId: string;
  parentId: string | null;
  text: string;
  status: CommentStatus;
  replyCount: number;
  openReportsCount: number;
  createdAt: Date;
}

export function newComment(input: { id: string; postId: string; authorId: string; parentId?: string | null; text: string }, now: Date): CommentProps {
  const text = input.text.trim();
  if (text.length === 0) throw new DomainError('VALIDATION_FAILED', { field: 'text', code: 'REQUIRED' });
  if (text.length > COMMENT_MAX) throw new DomainError('VALIDATION_FAILED', { field: 'text', code: 'TOO_LONG' });
  return { id: input.id, postId: input.postId, authorId: input.authorId, parentId: input.parentId ?? null, text, status: 'VISIBLE', replyCount: 0, openReportsCount: 0, createdAt: now };
}
