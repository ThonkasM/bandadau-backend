import type { Profile } from '../../entities/profile.entity';

export const PROFILE_REPOSITORY = Symbol('ProfileRepository');

export interface ProfileRepository {
  findById(userId: string): Promise<Profile | null>;
  findByIds(userIds: readonly string[]): Promise<Profile[]>;
  /** `$setOnInsert`: false when the profile already existed. */
  insertIfAbsent(profile: Profile): Promise<boolean>;
  save(profile: Profile): Promise<void>;
  findByPendingAvatar(mediaId: string): Promise<Profile[]>;
}
