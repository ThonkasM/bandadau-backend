import type { FollowProps } from '../../entities/follow.entity';

export const FOLLOW_REPOSITORY = Symbol('FollowRepository');

export interface FollowRepository {
  /** Returns the stored follow and whether it was created now. */
  insertIfAbsent(follow: FollowProps): Promise<{ follow: FollowProps; created: boolean }>;
  delete(followerId: string, followeeId: string): Promise<void>;
  isFollowing(followerId: string, followeeId: string): Promise<boolean>;
  findFolloweeIds(followerId: string, limit: number): Promise<string[]>;
  countFollowers(userId: string): Promise<number>;
  countFollowing(userId: string): Promise<number>;
}
