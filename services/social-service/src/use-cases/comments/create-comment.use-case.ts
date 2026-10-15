import { newComment, type CommentProps } from '../../entities/comment.entity';
import { DomainError } from '../../entities/errors/domain-error';
import { SocialEvents } from '../events';
import type { AuthorSummary } from '../outputs';
import type { Clock, CommentRepository, EventPublisher, IdGenerator, PostRepository, UnitOfWork } from '../ports';
import type { PostAccess } from '../posts/post-access';
import type { PostAssembler } from '../posts/post-assembler';

export interface CommentOutput {
  comment: CommentProps;
  author: AuthorSummary;
}

export class CreateCommentUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly comments: CommentRepository,
    private readonly access: PostAccess,
    private readonly assembler: PostAssembler,
    private readonly events: EventPublisher,
    private readonly uow: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: { postId: string; authorId: string; text: string; parentId?: string | null }): Promise<CommentOutput> {
    const post = await this.posts.findById(input.postId);
    if (!post || !(await this.access.canView(post, input.authorId))) throw new DomainError('NOT_FOUND');
    if (!post.isInteractable) throw new DomainError('POST_NOT_PUBLISHED');

    if (input.parentId) {
      const parent = await this.comments.findById(input.parentId);
      if (!parent || parent.postId !== post.id || parent.status === 'REMOVED') throw new DomainError('NOT_FOUND');
      if (parent.parentId) throw new DomainError('VALIDATION_FAILED', { field: 'parentId', code: 'INVALID_VALUE' });
    }

    const now = this.clock.now();
    const comment = newComment({ id: this.ids.next(), postId: post.id, authorId: input.authorId, parentId: input.parentId, text: input.text }, now);
    await this.uow.run(async () => {
      await this.comments.insert(comment);
      await this.posts.incrementComments(post.id, 1);
      if (comment.parentId) await this.comments.incrementReplyCount(comment.parentId);
      await this.events.publish(SocialEvents.commentCreated(comment, post.authorId, now));
    });
    const author = (await this.assembler.summaries([input.authorId])).get(input.authorId) as AuthorSummary;
    return { comment, author };
  }
}
