import { Inject, Injectable, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';

import { FeedController, FollowsController, GroupsController, PostsController, ProfilesController, ReportsController } from '../../interface-adapters/controllers/http/social.controllers';
import { HealthController } from '../../interface-adapters/controllers/http/health.controller';
import { InternalController } from '../../interface-adapters/controllers/http/internal.controllers';
import { IdentityEventsConsumer, MediaEventsConsumer } from '../../interface-adapters/controllers/messaging/events.consumers';
import {
  MongoCommentRepository,
  MongoContentStatsRepository,
  MongoFollowRepository,
  MongoGroupRepository,
  MongoMediaAssetViewRepository,
  MongoMembershipRepository,
  MongoProfileRepository,
  MongoReactionRepository,
  MongoReportRepository,
} from '../../interface-adapters/gateways/mongo/mongo-misc.repositories';
import { MongoPostRepository } from '../../interface-adapters/gateways/mongo/mongo-post.repository';
import { MongoContext } from '../../interface-adapters/gateways/mongo/mongo-context';
import type { JsonLogger } from '../../interface-adapters/logger';
import { newRequestContext, requestContext } from '../../interface-adapters/request-context';
import { CreateCommentUseCase } from '../../use-cases/comments/create-comment.use-case';
import { ListCommentsUseCase } from '../../use-cases/comments/list-comments.use-case';
import { GetFeedUseCase } from '../../use-cases/feed/get-feed.use-case';
import { ListGroupPostsUseCase } from '../../use-cases/feed/list-group-posts.use-case';
import { FollowUserUseCase, GetFollowSuggestionsUseCase, UnfollowUserUseCase } from '../../use-cases/follows/follow.use-cases';
import {
  CreateGroupUseCase,
  GetGroupUseCase,
  JoinGroupUseCase,
  LeaveGroupUseCase,
  ListGroupMembersUseCase,
  ListGroupsInternalUseCase,
  ReviewGroupMemberUseCase,
  SearchGroupsUseCase,
} from '../../use-cases/groups/group.use-cases';
import { OnUserReactivatedUseCase, OnUserRegisteredUseCase, OnUserSuspendedUseCase } from '../../use-cases/identity-events/identity-events.use-cases';
import { ApplyMediaDecisionUseCase } from '../../use-cases/media-events/apply-media-decision.use-case';
import { ReconcilePendingMediaUseCase } from '../../use-cases/media-events/reconcile-pending-media.use-case';
import {
  CLOCK,
  COMMENT_REPOSITORY,
  EVENT_PUBLISHER,
  FOLLOW_REPOSITORY,
  GROUP_REPOSITORY,
  ID_GENERATOR,
  MEDIA_GATEWAY,
  MEDIA_VIEW_REPOSITORY,
  MEMBERSHIP_REPOSITORY,
  POST_REPOSITORY,
  PROFILE_REPOSITORY,
  REACTION_REPOSITORY,
  REPORT_REPOSITORY,
  STATS_REPOSITORY,
  UNIT_OF_WORK,
} from '../../use-cases/ports';
import { CreatePostUseCase } from '../../use-cases/posts/create-post.use-case';
import { DeletePostUseCase } from '../../use-cases/posts/delete-post.use-case';
import { GetPostUseCase } from '../../use-cases/posts/get-post.use-case';
import { PostAccess } from '../../use-cases/posts/post-access';
import { PostAssembler } from '../../use-cases/posts/post-assembler';
import { GetProfileUseCase, ProfileReader, UpdateMyProfileUseCase } from '../../use-cases/profiles/profile.use-cases';
import { RemoveReactionUseCase, SetReactionUseCase } from '../../use-cases/reactions/set-reaction.use-case';
import { GetContentDailyStatsUseCase } from '../../use-cases/reports/daily-stats.use-case';
import { ListContentReportsUseCase, ListPostsByStatusUseCase, ResolveContentReportUseCase, UpdatePostStatusUseCase } from '../../use-cases/reports/moderation.use-cases';
import { ReportContentUseCase } from '../../use-cases/reports/report-content.use-case';
import type { Env } from '../config/env';
import { ENV, LOGGER, REPORT_THRESHOLD } from './tokens';

type Token = symbol | (new (...args: never[]) => unknown);

/** Composition root helper: use cases carry no Nest decorators, so each one is built by a factory with its ports. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function factory<C extends new (...args: any[]) => unknown>(cls: C, ...deps: Token[]) {
  return { provide: cls, inject: deps as never[], useFactory: (...args: ConstructorParameters<C>) => new cls(...args) };
}

@Injectable()
class PendingMediaSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(ReconcilePendingMediaUseCase) private readonly reconcile: ReconcilePendingMediaUseCase,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      const ctx = newRequestContext({ fallbackCorrelationId: 'pending-media-sweeper' });
      requestContext
        .run(ctx, () => this.reconcile.execute())
        .then((n) => n > 0 && this.logger.info('pending media reconciled', { posts: n }))
        .catch((error: unknown) => this.logger.error('pending media sweep failed', { err: String(error) }));
    }, this.env.PENDING_MEDIA_SWEEP_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

const repo = <T>(token: symbol, cls: new (ctx: MongoContext) => T) => ({ provide: token, inject: [MongoContext], useFactory: (ctx: MongoContext) => new cls(ctx) });

@Module({
  controllers: [HealthController, ProfilesController, PostsController, FeedController, FollowsController, GroupsController, ReportsController, InternalController],
  providers: [
    repo(POST_REPOSITORY, MongoPostRepository),
    repo(PROFILE_REPOSITORY, MongoProfileRepository),
    repo(FOLLOW_REPOSITORY, MongoFollowRepository),
    repo(COMMENT_REPOSITORY, MongoCommentRepository),
    repo(REACTION_REPOSITORY, MongoReactionRepository),
    repo(GROUP_REPOSITORY, MongoGroupRepository),
    repo(MEMBERSHIP_REPOSITORY, MongoMembershipRepository),
    repo(REPORT_REPOSITORY, MongoReportRepository),
    repo(MEDIA_VIEW_REPOSITORY, MongoMediaAssetViewRepository),
    repo(STATS_REPOSITORY, MongoContentStatsRepository),
    { provide: REPORT_THRESHOLD, inject: [ENV], useFactory: (env: Env) => env.REPORT_HIDE_THRESHOLD },

    factory(PostAssembler, PROFILE_REPOSITORY, REACTION_REPOSITORY, MEDIA_VIEW_REPOSITORY, MEDIA_GATEWAY),
    factory(PostAccess, FOLLOW_REPOSITORY, GROUP_REPOSITORY, MEMBERSHIP_REPOSITORY),
    factory(ProfileReader, PROFILE_REPOSITORY, FOLLOW_REPOSITORY, POST_REPOSITORY, PostAssembler),

    factory(GetProfileUseCase, ProfileReader),
    factory(UpdateMyProfileUseCase, PROFILE_REPOSITORY, MEDIA_GATEWAY, ProfileReader, CLOCK),
    factory(CreatePostUseCase, POST_REPOSITORY, PROFILE_REPOSITORY, GROUP_REPOSITORY, MEMBERSHIP_REPOSITORY, MEDIA_VIEW_REPOSITORY, MEDIA_GATEWAY, EVENT_PUBLISHER, UNIT_OF_WORK, ID_GENERATOR, CLOCK, PostAssembler),
    factory(GetPostUseCase, POST_REPOSITORY, PostAccess, PostAssembler),
    factory(DeletePostUseCase, POST_REPOSITORY, PostAccess, EVENT_PUBLISHER, UNIT_OF_WORK, CLOCK),
    factory(GetFeedUseCase, POST_REPOSITORY, PROFILE_REPOSITORY, FOLLOW_REPOSITORY, MEMBERSHIP_REPOSITORY, PostAssembler, CLOCK),
    factory(ListGroupPostsUseCase, GROUP_REPOSITORY, MEMBERSHIP_REPOSITORY, POST_REPOSITORY, PostAssembler),
    factory(CreateCommentUseCase, POST_REPOSITORY, COMMENT_REPOSITORY, PostAccess, PostAssembler, EVENT_PUBLISHER, UNIT_OF_WORK, ID_GENERATOR, CLOCK),
    factory(ListCommentsUseCase, POST_REPOSITORY, COMMENT_REPOSITORY, PostAccess, PostAssembler),
    factory(SetReactionUseCase, POST_REPOSITORY, REACTION_REPOSITORY, PostAccess, EVENT_PUBLISHER, UNIT_OF_WORK, CLOCK),
    factory(RemoveReactionUseCase, POST_REPOSITORY, REACTION_REPOSITORY, PostAccess, UNIT_OF_WORK),
    factory(FollowUserUseCase, FOLLOW_REPOSITORY, PROFILE_REPOSITORY, EVENT_PUBLISHER, UNIT_OF_WORK, CLOCK),
    factory(UnfollowUserUseCase, FOLLOW_REPOSITORY, PROFILE_REPOSITORY),
    factory(GetFollowSuggestionsUseCase),
    factory(CreateGroupUseCase, GROUP_REPOSITORY, MEMBERSHIP_REPOSITORY, UNIT_OF_WORK, ID_GENERATOR, CLOCK),
    factory(SearchGroupsUseCase, GROUP_REPOSITORY, MEMBERSHIP_REPOSITORY),
    factory(ListGroupsInternalUseCase, GROUP_REPOSITORY),
    factory(GetGroupUseCase, GROUP_REPOSITORY, MEMBERSHIP_REPOSITORY),
    factory(JoinGroupUseCase, GROUP_REPOSITORY, MEMBERSHIP_REPOSITORY, EVENT_PUBLISHER, UNIT_OF_WORK, CLOCK),
    factory(ListGroupMembersUseCase, GROUP_REPOSITORY, MEMBERSHIP_REPOSITORY, PostAssembler),
    factory(ReviewGroupMemberUseCase, GROUP_REPOSITORY, MEMBERSHIP_REPOSITORY, UNIT_OF_WORK, CLOCK),
    factory(LeaveGroupUseCase, GROUP_REPOSITORY, MEMBERSHIP_REPOSITORY, UNIT_OF_WORK, CLOCK),
    factory(ReportContentUseCase, POST_REPOSITORY, COMMENT_REPOSITORY, REPORT_REPOSITORY, PostAccess, EVENT_PUBLISHER, UNIT_OF_WORK, ID_GENERATOR, CLOCK, REPORT_THRESHOLD),
    factory(ListPostsByStatusUseCase, POST_REPOSITORY, PostAssembler),
    factory(UpdatePostStatusUseCase, POST_REPOSITORY, PostAssembler, EVENT_PUBLISHER, UNIT_OF_WORK, CLOCK),
    factory(ListContentReportsUseCase, REPORT_REPOSITORY),
    factory(ResolveContentReportUseCase, REPORT_REPOSITORY, POST_REPOSITORY, COMMENT_REPOSITORY, EVENT_PUBLISHER, UNIT_OF_WORK, CLOCK),
    factory(GetContentDailyStatsUseCase, STATS_REPOSITORY),
    factory(ApplyMediaDecisionUseCase, MEDIA_VIEW_REPOSITORY, POST_REPOSITORY, PROFILE_REPOSITORY, EVENT_PUBLISHER, UNIT_OF_WORK, CLOCK),
    factory(ReconcilePendingMediaUseCase, POST_REPOSITORY, MEDIA_VIEW_REPOSITORY, EVENT_PUBLISHER, UNIT_OF_WORK, CLOCK),
    factory(OnUserRegisteredUseCase, PROFILE_REPOSITORY, CLOCK),
    factory(OnUserSuspendedUseCase, POST_REPOSITORY, COMMENT_REPOSITORY, EVENT_PUBLISHER, UNIT_OF_WORK, CLOCK),
    factory(OnUserReactivatedUseCase, POST_REPOSITORY, COMMENT_REPOSITORY, UNIT_OF_WORK, CLOCK),
    MediaEventsConsumer,
    IdentityEventsConsumer,
    PendingMediaSweeper,
  ],
})
export class SocialModule {}
