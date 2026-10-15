import { DomainError } from '../../entities/errors/domain-error';
import type { ProfilePatch, ProfileProps } from '../../entities/profile.entity';
import type { Clock, FollowRepository, MediaGateway, PostRepository, ProfileRepository } from '../ports';
import type { PostAssembler } from '../posts/post-assembler';

export interface ProfileOutput {
  profile: ProfileProps;
  avatarUrl: string | null;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  followedByMe: boolean;
}

export class ProfileReader {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly follows: FollowRepository,
    private readonly posts: PostRepository,
    private readonly assembler: PostAssembler,
  ) {}

  async read(userId: string, viewerId: string | null): Promise<ProfileOutput> {
    const profile = await this.profiles.findById(userId);
    if (!profile) throw new DomainError('NOT_FOUND');
    const [followersCount, followingCount, postsCount, followedByMe, avatarUrl] = await Promise.all([
      this.follows.countFollowers(userId),
      this.follows.countFollowing(userId),
      this.posts.countPublishedByAuthor(userId),
      viewerId && viewerId !== userId ? this.follows.isFollowing(viewerId, userId) : Promise.resolve(false),
      this.assembler.avatarUrl(profile.snapshot.avatarMediaId),
    ]);
    return { profile: profile.snapshot, avatarUrl, followersCount, followingCount, postsCount, followedByMe };
  }
}

/** getMyProfile, getProfile and getProfileInternal (viewerId = null). */
export class GetProfileUseCase {
  constructor(private readonly reader: ProfileReader) {}

  execute(input: { userId: string; viewerId: string | null }): Promise<ProfileOutput> {
    return this.reader.read(input.userId, input.viewerId);
  }
}

export interface UpdateProfileInput extends ProfilePatch {
  userId: string;
  /** undefined = unchanged, null = remove the avatar. */
  avatarMediaId?: string | null;
}

export class UpdateMyProfileUseCase {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly media: MediaGateway,
    private readonly reader: ProfileReader,
    private readonly clock: Clock,
  ) {}

  async execute(input: UpdateProfileInput): Promise<ProfileOutput> {
    const profile = await this.profiles.findById(input.userId);
    if (!profile) throw new DomainError('NOT_FOUND');
    const now = this.clock.now();
    const { userId, avatarMediaId, ...patch } = input;
    profile.update(patch, now);

    if (avatarMediaId === null) profile.setPendingAvatar(null, now);
    else if (avatarMediaId !== undefined) {
      const [asset] = await this.media.getAssets([avatarMediaId]);
      if (!asset) throw new DomainError('MEDIA_NOT_FOUND');
      if (asset.ownerId !== userId) throw new DomainError('MEDIA_NOT_OWNED');
      if (asset.kind !== 'IMAGE') throw new DomainError('INVALID_MEDIA_KIND');
      if (asset.status === 'FLAGGED' || asset.status === 'REJECTED') throw new DomainError('MEDIA_NOT_APPROVED');
      profile.setPendingAvatar(avatarMediaId, now);
      if (asset.status === 'APPROVED') profile.promoteAvatar(now);
    }
    await this.profiles.save(profile);
    return this.reader.read(userId, userId);
  }
}
