import type { MediaKind, MediaStatus } from '../../entities/value-objects/media';
import { SocialEvents } from '../events';
import type { Clock, EventPublisher, MediaAssetViewRepository, PostRepository, ProfileRepository, UnitOfWork } from '../ports';

export interface MediaDecisionInput {
  mediaId: string;
  ownerId: string;
  kind: MediaKind;
  status: Extract<MediaStatus, 'APPROVED' | 'FLAGGED' | 'REJECTED'>;
}

/**
 * Consumes `bandada.media.asset.{approved,flagged,rejected}`: updates the media read model, resolves a pending avatar and
 * re-evaluates every post that references the asset (PENDING_MEDIA -> PUBLISHED / HIDDEN). Runs inside the consumer's inbox transaction.
 */
export class ApplyMediaDecisionUseCase {
  constructor(
    private readonly views: MediaAssetViewRepository,
    private readonly posts: PostRepository,
    private readonly profiles: ProfileRepository,
    private readonly events: EventPublisher,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: MediaDecisionInput): Promise<void> {
    await this.uow.run(async () => {
      const now = this.clock.now();
      await this.views.upsert({ mediaId: input.mediaId, ownerId: input.ownerId, kind: input.kind, status: input.status, updatedAt: now });

      for (const profile of await this.profiles.findByPendingAvatar(input.mediaId)) {
        if (profile.userId !== input.ownerId) continue;
        const changed = input.status === 'APPROVED' ? profile.promoteAvatar(now) : profile.discardPendingAvatar(now);
        if (changed) await this.profiles.save(profile);
      }

      for (const post of await this.posts.findByMediaId(input.mediaId)) {
        const previous = post.status;
        const views = await this.views.findMany(post.mediaIds as string[]);
        const transition = post.applyMediaStatuses(views, now);
        if (!transition || !(await this.posts.saveStatus(post, [previous]))) continue;
        if (transition === 'published') await this.events.publish(SocialEvents.postPublished(post, now));
        else await this.events.publish(SocialEvents.postHidden(post.id, post.authorId, 'MEDIA_FLAGGED', now));
      }
    });
  }
}
