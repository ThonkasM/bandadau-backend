import { Profile } from '../../entities/profile.entity';
import { SocialEvents } from '../events';
import type { Clock, CommentRepository, EventPublisher, PostRepository, ProfileRepository, UnitOfWork } from '../ports';

export class OnUserRegisteredUseCase {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly clock: Clock,
  ) {}

  /** Idempotent (`$setOnInsert`): a replayed event never overwrites an edited profile. */
  async execute(input: { userId: string; displayName: string; universityId?: string | null; career?: string | null }): Promise<void> {
    await this.profiles.insertIfAbsent(Profile.register(input, this.clock.now()));
  }
}

export class OnUserSuspendedUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly comments: CommentRepository,
    private readonly events: EventPublisher,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: { userId: string }): Promise<void> {
    await this.uow.run(async () => {
      const now = this.clock.now();
      const hidden = await this.posts.hidePublishedByAuthor(input.userId, 'AUTHOR_SUSPENDED', now);
      for (const post of hidden) await this.events.publish(SocialEvents.postHidden(post.id, post.authorId, 'AUTHOR_SUSPENDED', now));
      await this.comments.hideVisibleByAuthor(input.userId);
    });
  }
}

export class OnUserReactivatedUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly comments: CommentRepository,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: { userId: string }): Promise<void> {
    await this.uow.run(async () => {
      await this.posts.restoreHiddenByAuthor(input.userId, 'AUTHOR_SUSPENDED', this.clock.now());
      await this.comments.restoreHiddenByAuthor(input.userId);
    });
  }
}
