import type { ReactionType } from '../../entities/post.entity';

export const REACTION_REPOSITORY = Symbol('ReactionRepository');

export interface ReactionRepository {
  /** Upsert; returns the previous type (null when there was none). */
  set(postId: string, userId: string, type: ReactionType, now: Date): Promise<{ previous: ReactionType | null }>;
  /** Returns the removed type, or null when the user had no reaction. */
  remove(postId: string, userId: string): Promise<ReactionType | null>;
  findMine(postIds: readonly string[], userId: string): Promise<Map<string, ReactionType>>;
}
