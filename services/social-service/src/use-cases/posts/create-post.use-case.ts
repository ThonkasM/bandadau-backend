import { DomainError } from '../../entities/errors/domain-error';
import { Post, type PostVisibility } from '../../entities/post.entity';
import type { MediaAssetView, MediaStatus } from '../../entities/value-objects/media';
import { SocialEvents } from '../events';
import type { PostOutput } from '../outputs';
import type {
  Clock,
  EventPublisher,
  IdGenerator,
  MediaAssetViewRepository,
  MediaGateway,
  MembershipRepository,
  GroupRepository,
  PostRepository,
  ProfileRepository,
  UnitOfWork,
} from '../ports';
import type { PostAssembler } from './post-assembler';

export interface CreatePostInput {
  authorId: string;
  clientId: string;
  text: string;
  visibility: PostVisibility;
  groupId?: string | null;
  mediaIds: string[];
}

export interface CreatePostOutput {
  output: PostOutput;
  /** True when `(authorId, clientId)` already existed: the HTTP layer answers 200 instead of 201. */
  replayed: boolean;
}

const FINAL: readonly MediaStatus[] = ['APPROVED', 'FLAGGED', 'REJECTED'];

export class CreatePostUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly profiles: ProfileRepository,
    private readonly groups: GroupRepository,
    private readonly memberships: MembershipRepository,
    private readonly views: MediaAssetViewRepository,
    private readonly media: MediaGateway,
    private readonly events: EventPublisher,
    private readonly uow: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly assembler: PostAssembler,
  ) {}

  async execute(input: CreatePostInput): Promise<CreatePostOutput> {
    const existing = await this.posts.findByAuthorAndClientId(input.authorId, input.clientId);
    if (existing) return this.replay(existing, input.authorId);

    if (input.visibility === 'GROUP') await this.assertGroupMember(input.groupId ?? null, input.authorId);

    const mediaViews = await this.resolveMedia(input.mediaIds);
    const profile = await this.profiles.findById(input.authorId);
    const now = this.clock.now();
    const post = Post.create(
      {
        id: this.ids.next(),
        clientId: input.clientId,
        authorId: input.authorId,
        authorUniversityId: profile?.snapshot.universityId ?? null,
        authorCareer: profile?.snapshot.career ?? null,
        text: input.text,
        visibility: input.visibility,
        groupId: input.groupId ?? null,
        mediaIds: input.mediaIds,
        media: input.mediaIds.map((id) => mediaViews.get(id) as MediaAssetView),
      },
      now,
    );

    try {
      await this.uow.run(async () => {
        await this.posts.insert(post);
        await this.events.publish(SocialEvents.postCreated(post, now));
        if (post.status === 'PUBLISHED') await this.events.publish(SocialEvents.postPublished(post, now));
        if (post.status === 'HIDDEN') await this.events.publish(SocialEvents.postHidden(post.id, post.authorId, 'MEDIA_FLAGGED', now));
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === 'DUPLICATE_CLIENT_ID') {
        const winner = await this.posts.findByAuthorAndClientId(input.authorId, input.clientId);
        if (winner) return this.replay(winner, input.authorId);
      }
      throw error;
    }
    const [output] = await this.assembler.assemble([post], input.authorId);
    return { output: output as PostOutput, replayed: false };
  }

  private async replay(post: Post, viewerId: string): Promise<CreatePostOutput> {
    const [output] = await this.assembler.assemble([post], viewerId);
    return { output: output as PostOutput, replayed: true };
  }

  private async assertGroupMember(groupId: string | null, userId: string): Promise<void> {
    if (!groupId) throw new DomainError('GROUP_REQUIRED');
    const group = await this.groups.findById(groupId);
    if (!group) throw new DomainError('GROUP_NOT_FOUND');
    const membership = await this.memberships.find(groupId, userId);
    if (membership?.status !== 'ACTIVE') throw new DomainError('GROUP_MEMBERSHIP_REQUIRED');
  }

  /** Local read model first (fed by media events); media-service only for what is unknown or not yet final. */
  private async resolveMedia(ids: readonly string[]): Promise<Map<string, MediaAssetView>> {
    if (ids.length === 0) return new Map();
    const views = await this.views.findMany(ids);
    const stale = ids.filter((id) => {
      const v = views.get(id);
      return !v || !FINAL.includes(v.status);
    });
    if (stale.length > 0) {
      const unknown = stale.filter((id) => !views.has(id));
      let infos: Awaited<ReturnType<MediaGateway['getAssets']>> = [];
      try {
        infos = await this.media.getAssets(stale);
      } catch (error) {
        if (unknown.length > 0) throw error;
      }
      const found = new Set(infos.map((i) => i.mediaId));
      if (unknown.some((id) => !found.has(id))) throw new DomainError('MEDIA_NOT_FOUND');
      const now = this.clock.now();
      for (const info of infos) {
        const view: MediaAssetView = { mediaId: info.mediaId, ownerId: info.ownerId, kind: info.kind, status: info.status, updatedAt: now };
        await this.views.upsertIfNotFinal(view);
        const current = views.get(info.mediaId);
        if (!current || !FINAL.includes(current.status)) views.set(info.mediaId, view);
      }
    }
    return views;
  }
}
