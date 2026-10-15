import { DomainError } from '../../entities/errors/domain-error';
import type { PostOutput } from '../outputs';
import type { PostRepository } from '../ports';
import type { PostAccess } from './post-access';
import type { PostAssembler } from './post-assembler';

export class GetPostUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly access: PostAccess,
    private readonly assembler: PostAssembler,
  ) {}

  async execute(input: { postId: string; viewerId: string }): Promise<PostOutput> {
    const post = await this.posts.findById(input.postId);
    if (!post || !(await this.access.canView(post, input.viewerId))) throw new DomainError('NOT_FOUND');
    const [output] = await this.assembler.assemble([post], input.viewerId);
    return output as PostOutput;
  }
}
