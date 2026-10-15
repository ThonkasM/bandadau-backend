import { SocialEvents } from '../events';
import type { Clock, EventPublisher, MediaAssetViewRepository, PostRepository, UnitOfWork } from '../ports';

const GRACE_MS = 60_000;
const TIMEOUT_MS = 24 * 3_600_000;

/**
 * Sweeper for the rare race where a media event is consumed before the post is stored (or never arrives): re-evaluates
 * PENDING_MEDIA posts against the media read model and hides the ones pending for more than 24 h (UC-05 18c).
 */
export class ReconcilePendingMediaUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly views: MediaAssetViewRepository,
    private readonly events: EventPublisher,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(batch = 100): Promise<number> {
    const now = this.clock.now();
    const pending = await this.posts.findPendingMedia(new Date(now.getTime() - GRACE_MS), batch);
    let changed = 0;
    for (const post of pending) {
      const previous = post.status;
      const views = await this.views.findMany(post.mediaIds as string[]);
      let transition = post.applyMediaStatuses(views, now);
      if (!transition && now.getTime() - post.snapshot.createdAt.getTime() > TIMEOUT_MS && post.hideForMediaTimeout(now)) transition = 'hidden';
      if (!transition) continue;
      await this.uow.run(async () => {
        if (!(await this.posts.saveStatus(post, [previous]))) return;
        changed++;
        if (transition === 'published') await this.events.publish(SocialEvents.postPublished(post, now));
        else await this.events.publish(SocialEvents.postHidden(post.id, post.authorId, 'MEDIA_FLAGGED', now));
      });
    }
    return changed;
  }
}
