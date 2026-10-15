import { DomainError } from '../../entities/errors/domain-error';
import { type ReactionCounts, type ReactionType } from '../../entities/post.entity';
import { SocialEvents } from '../events';
import type { Clock, EventPublisher, PostRepository, ReactionRepository, UnitOfWork } from '../ports';
import type { PostAccess } from '../posts/post-access';

export interface ReactionStateOutput {
  postId: string;
  myReaction: ReactionType | null;
  reactionCounts: ReactionCounts;
}

export class SetReactionUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly reactions: ReactionRepository,
    private readonly access: PostAccess,
    private readonly events: EventPublisher,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: { postId: string; userId: string; type: ReactionType }): Promise<ReactionStateOutput> {
    const post = await this.posts.findById(input.postId);
    if (!post || !post.isInteractable || !(await this.access.canView(post, input.userId))) throw new DomainError('NOT_FOUND');
    const now = this.clock.now();
    await this.uow.run(async () => {
      const { previous } = await this.reactions.set(post.id, input.userId, input.type, now);
      if (previous === input.type) return;
      await this.posts.adjustReactionCounts(post.id, { add: input.type, ...(previous ? { remove: previous } : {}) });
      await this.events.publish(SocialEvents.reactionSet(post, input.userId, input.type, previous, now));
    });
    const fresh = (await this.posts.findById(post.id)) ?? post;
    return { postId: post.id, myReaction: input.type, reactionCounts: fresh.snapshot.reactionCounts };
  }
}

export class RemoveReactionUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly reactions: ReactionRepository,
    private readonly access: PostAccess,
    private readonly uow: UnitOfWork,
  ) {}

  /** Idempotent: removing a reaction that does not exist is a no-op. No domain event (UC-07 B8). */
  async execute(input: { postId: string; userId: string }): Promise<void> {
    const post = await this.posts.findById(input.postId);
    if (!post || !(await this.access.canView(post, input.userId))) throw new DomainError('NOT_FOUND');
    await this.uow.run(async () => {
      const removed = await this.reactions.remove(post.id, input.userId);
      if (removed) await this.posts.adjustReactionCounts(post.id, { remove: removed });
    });
  }
}

