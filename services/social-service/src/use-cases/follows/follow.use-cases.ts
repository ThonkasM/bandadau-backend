import { DomainError } from '../../entities/errors/domain-error';
import { newFollow, type FollowProps } from '../../entities/follow.entity';
import { SocialEvents } from '../events';
import type { AuthorSummary } from '../outputs';
import type { Clock, EventPublisher, FollowRepository, ProfileRepository, UnitOfWork } from '../ports';

export class FollowUserUseCase {
  constructor(
    private readonly follows: FollowRepository,
    private readonly profiles: ProfileRepository,
    private readonly events: EventPublisher,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  /** Idempotent: an existing follow answers with the stored relation and publishes nothing. */
  async execute(input: { followerId: string; followeeId: string }): Promise<FollowProps> {
    const now = this.clock.now();
    const candidate = newFollow(input.followerId, input.followeeId, now);
    if (!(await this.profiles.findById(input.followeeId))) throw new DomainError('NOT_FOUND');
    return this.uow.run(async () => {
      const { follow, created } = await this.follows.insertIfAbsent(candidate);
      if (created) await this.events.publish(SocialEvents.followCreated(input.followerId, input.followeeId, now));
      return follow;
    });
  }
}

export class UnfollowUserUseCase {
  constructor(
    private readonly follows: FollowRepository,
    private readonly profiles: ProfileRepository,
  ) {}

  async execute(input: { followerId: string; followeeId: string }): Promise<void> {
    if (!(await this.profiles.findById(input.followeeId))) throw new DomainError('NOT_FOUND');
    await this.follows.delete(input.followerId, input.followeeId);
  }
}

export interface FollowSuggestionOutput {
  profile: AuthorSummary;
  career: string | null;
  score: number;
  reasons: string[];
  mutualFollowsCount: number;
}

/** Phase 1: no `follow-suggester` model yet; the contract allows an empty single page. */
export class GetFollowSuggestionsUseCase {
  async execute(_input: { userId: string; limit?: number }): Promise<FollowSuggestionOutput[]> {
    return [];
  }
}
