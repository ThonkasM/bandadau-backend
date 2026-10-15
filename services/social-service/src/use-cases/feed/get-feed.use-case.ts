import { recencyScore, FEED_WINDOW_HOURS } from '../../entities/policies/feed-recency.policy';
import type { PostOutput } from '../outputs';
import { paginate } from '../paginate';
import type { Clock, FollowRepository, KeysetCursor, MembershipRepository, Page, PostRepository, ProfileRepository } from '../ports';
import { DEFAULT_LIMIT } from '../ports';
import type { PostAssembler } from '../posts/post-assembler';

export type FeedSource = 'FOLLOWING' | 'GROUP' | 'RECOMMENDED' | 'OWN';

export interface FeedItemOutput {
  output: PostOutput;
  source: FeedSource;
  score: number;
}

const MAX_FOLLOWING = 5000;
const MAX_GROUPS = 500;

/**
 * Phase 1 feed (UC-06 without the ML ranker): candidates from followed authors, own posts, my groups and popular posts of my
 * career within 72 h; visibility filter; score = recency; stable keyset cursor on (createdAt, id).
 */
export class GetFeedUseCase {
  constructor(
    private readonly posts: PostRepository,
    private readonly profiles: ProfileRepository,
    private readonly follows: FollowRepository,
    private readonly memberships: MembershipRepository,
    private readonly assembler: PostAssembler,
    private readonly clock: Clock,
  ) {}

  async execute(input: { userId: string; cursor: KeysetCursor | null; limit?: number }): Promise<Page<FeedItemOutput>> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const now = this.clock.now();
    const [profile, followingIds, groupIds] = await Promise.all([
      this.profiles.findById(input.userId),
      this.follows.findFolloweeIds(input.userId, MAX_FOLLOWING),
      this.memberships.listActiveGroupIds(input.userId, MAX_GROUPS),
    ]);
    const rows = await this.posts.findFeedPage({
      userId: input.userId,
      followingIds,
      groupIds,
      career: profile?.snapshot.career ?? null,
      universityId: profile?.snapshot.universityId ?? null,
      popularSince: new Date(now.getTime() - FEED_WINDOW_HOURS * 3_600_000),
      cursor: input.cursor,
      limit: limit + 1,
    });
    const page = paginate(rows, limit, (p) => ({ createdAt: p.snapshot.createdAt, id: p.id }));
    const outputs = await this.assembler.assemble(page.items, input.userId);
    const following = new Set(followingIds);
    const groups = new Set(groupIds);
    const items = outputs.map((output): FeedItemOutput => {
      const p = output.post;
      const source: FeedSource =
        p.authorId === input.userId ? 'OWN' : following.has(p.authorId) ? 'FOLLOWING' : p.groupId && groups.has(p.groupId) ? 'GROUP' : 'RECOMMENDED';
      return { output, source, score: recencyScore(p.createdAt, now) };
    });
    return { items, nextCursor: page.nextCursor };
  }
}
