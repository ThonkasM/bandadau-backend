import { DomainError } from '../../entities/errors/domain-error';
import { SocialEvents } from '../events';
import type { Clock, EventPublisher, PostRepository, UnitOfWork } from '../ports';
import type { PostAccess } from './post-access';

export class DeletePostUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly access: PostAccess,
    private readonly events: EventPublisher,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  /** Idempotent: deleting a REMOVED post is a no-op. */
  async execute(input: { postId: string; userId: string }): Promise<void> {
    const post = await this.posts.findById(input.postId);
    if (!post) throw new DomainError('NOT_FOUND');
    if (post.authorId !== input.userId) {
      throw new DomainError((await this.access.canView(post, input.userId)) ? 'FORBIDDEN' : 'NOT_FOUND');
    }
    const previous = post.status;
    const now = this.clock.now();
    if (!post.deleteByAuthor(now)) return;
    await this.uow.run(async () => {
      if (await this.posts.saveStatus(post, [previous])) {
        await this.events.publish(SocialEvents.postDeleted(post, input.userId, 'AUTHOR', now));
      }
    });
  }
}
