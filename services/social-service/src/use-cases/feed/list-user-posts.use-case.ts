import { recencyScore } from '../../entities/policies/feed-recency.policy';
import type { PostVisibility } from '../../entities/post.entity';
import { paginate } from '../paginate';
import type { Clock, FollowRepository, KeysetCursor, Page, PostRepository } from '../ports';
import { DEFAULT_LIMIT } from '../ports';
import type { PostAssembler } from '../posts/post-assembler';
import type { FeedItemOutput, FeedSource } from './get-feed.use-case';

/**
 * UC-04: posts of a student for the profile grid. Visibility is resolved against the viewer
 * (own → all; following → PUBLIC + FOLLOWERS; otherwise → PUBLIC). Stable keyset cursor.
 */
export class ListUserPostsUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly follows: FollowRepository,
    private readonly assembler: PostAssembler,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    authorId: string;
    viewerId: string;
    cursor: KeysetCursor | null;
    limit?: number;
  }): Promise<Page<FeedItemOutput>> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const own = input.viewerId === input.authorId;
    const following = own || (await this.follows.isFollowing(input.viewerId, input.authorId));
    const visibilities: PostVisibility[] = own
      ? ['PUBLIC', 'FOLLOWERS', 'GROUP']
      : following
        ? ['PUBLIC', 'FOLLOWERS']
        : ['PUBLIC'];
    const rows = await this.posts.listAuthorPosts(input.authorId, visibilities, input.cursor, limit + 1);
    const page = paginate(rows, limit, (p) => ({ createdAt: p.snapshot.createdAt, id: p.id }));
    const outputs = await this.assembler.assemble(page.items, input.viewerId);
    const now = this.clock.now();
    const source: FeedSource = own ? 'OWN' : following ? 'FOLLOWING' : 'RECOMMENDED';
    const items = outputs.map((output): FeedItemOutput => ({
      output,
      source,
      score: recencyScore(output.post.createdAt, now),
    }));
    return { items, nextCursor: page.nextCursor };
  }
}
