import { DomainError } from './errors/domain-error';

export interface FollowProps {
  followerId: string;
  followeeId: string;
  createdAt: Date;
}

export function newFollow(followerId: string, followeeId: string, now: Date): FollowProps {
  if (followerId === followeeId) throw new DomainError('CANNOT_FOLLOW_SELF');
  return { followerId, followeeId, createdAt: now };
}
