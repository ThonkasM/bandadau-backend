import { DomainError } from '../../entities/errors/domain-error';
import type { PostOutput } from '../outputs';
import { paginate } from '../paginate';
import type { GroupRepository, KeysetCursor, MembershipRepository, Page, PostRepository } from '../ports';
import { DEFAULT_LIMIT } from '../ports';
import type { PostAssembler } from '../posts/post-assembler';

export class ListGroupPostsUseCase {
  constructor(
    private readonly groups: GroupRepository,
    private readonly memberships: MembershipRepository,
    private readonly posts: PostRepository,
    private readonly assembler: PostAssembler,
  ) {}

  async execute(input: { groupId: string; viewerId: string; cursor: KeysetCursor | null; limit?: number }): Promise<Page<PostOutput>> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const group = await this.groups.findById(input.groupId);
    if (!group) throw new DomainError('NOT_FOUND');
    if (group.isPrivate) {
      const membership = await this.memberships.find(input.groupId, input.viewerId);
      if (membership?.status !== 'ACTIVE') throw new DomainError('GROUP_MEMBERSHIP_REQUIRED');
    }
    const rows = await this.posts.listGroupPosts(input.groupId, input.cursor, limit + 1);
    const page = paginate(rows, limit, (p) => ({ createdAt: p.snapshot.createdAt, id: p.id }));
    return { items: await this.assembler.assemble(page.items, input.viewerId), nextCursor: page.nextCursor };
  }
}
