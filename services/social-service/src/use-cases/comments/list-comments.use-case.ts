import { DomainError } from '../../entities/errors/domain-error';
import { paginate } from '../paginate';
import type { CommentRepository, KeysetCursor, Page, PostRepository } from '../ports';
import { DEFAULT_LIMIT } from '../ports';
import type { PostAccess } from '../posts/post-access';
import type { PostAssembler } from '../posts/post-assembler';
import type { CommentOutput } from './create-comment.use-case';

export class ListCommentsUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly comments: CommentRepository,
    private readonly access: PostAccess,
    private readonly assembler: PostAssembler,
  ) {}

  async execute(input: { postId: string; viewerId: string; cursor: KeysetCursor | null; limit?: number }): Promise<Page<CommentOutput>> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const post = await this.posts.findById(input.postId);
    if (!post || !(await this.access.canView(post, input.viewerId))) throw new DomainError('NOT_FOUND');
    const rows = await this.comments.list(post.id, input.viewerId, input.cursor, limit + 1);
    const page = paginate(rows, limit, (c) => ({ createdAt: c.createdAt, id: c.id }));
    const authors = await this.assembler.summaries(page.items.map((c) => c.authorId));
    return {
      items: page.items.map((comment) => ({ comment, author: authors.get(comment.authorId) as CommentOutput['author'] })),
      nextCursor: page.nextCursor,
    };
  }
}
