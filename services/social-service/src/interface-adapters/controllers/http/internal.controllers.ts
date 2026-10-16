import { Internal } from '@bandada/auth-ts/nest';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Patch, Query, UseGuards } from '@nestjs/common';
import type { z } from 'zod';

import { ListGroupsInternalUseCase } from '../../../use-cases/groups/group.use-cases';
import { GetProfileNamesUseCase, GetProfileUseCase } from '../../../use-cases/profiles/profile.use-cases';
import { GetCareerStatsUseCase } from '../../../use-cases/reports/career-stats.use-case';
import { GetContentRankingsUseCase } from '../../../use-cases/reports/content-rankings.use-case';
import { GetContentDailyStatsUseCase } from '../../../use-cases/reports/daily-stats.use-case';
import {
  GetCommentInternalUseCase,
  GetPostInternalUseCase,
  ListContentReportsUseCase,
  ListPostsByStatusUseCase,
  ResolveContentReportUseCase,
  UpdatePostStatusUseCase,
} from '../../../use-cases/reports/moderation.use-cases';
import { decodeCursor, decodeOffset, encodeOffset } from '../../presenters/cursor';
import { page, presentComment, presentGroup, presentModerationPost, presentPost, presentProfile, presentReport, presentStats } from '../../presenters/resource.presenter';
import {
  actorHeader,
  careerStatsQuery,
  internalGroupsQuery,
  postsByStatusQuery,
  profileNamesQuery,
  rankingsQuery,
  reportsQuery,
  resolveReportBody,
  statsQuery,
  updatePostStatusBody,
  uuidParam,
} from './dto/schemas';
import { ZodValidationPipe } from './dto/zod-validation.pipe';
import { InternalScopesGuard } from './internal-scopes.guard';

type In<S extends z.ZodType> = z.output<S>;
const actor = new ZodValidationPipe(actorHeader, 'X-Actor-Id');

/** Service-to-service API (`/internal/v1`), blocked at Traefik and guarded with a service token. */
@Controller('internal/v1')
@UseGuards(InternalScopesGuard) // declared above @Internal(): runs after ServiceAuthGuard, which sets `request.user`
@Internal()
export class InternalController {
  constructor(
    @Inject(ListPostsByStatusUseCase) private readonly postsByStatus: ListPostsByStatusUseCase,
    @Inject(GetPostInternalUseCase) private readonly getPost: GetPostInternalUseCase,
    @Inject(GetCommentInternalUseCase) private readonly getComment: GetCommentInternalUseCase,
    @Inject(UpdatePostStatusUseCase) private readonly updateStatus: UpdatePostStatusUseCase,
    @Inject(ListContentReportsUseCase) private readonly reports: ListContentReportsUseCase,
    @Inject(ResolveContentReportUseCase) private readonly resolve: ResolveContentReportUseCase,
    @Inject(GetProfileUseCase) private readonly profile: GetProfileUseCase,
    @Inject(GetProfileNamesUseCase) private readonly profileNames: GetProfileNamesUseCase,
    @Inject(ListGroupsInternalUseCase) private readonly groups: ListGroupsInternalUseCase,
    @Inject(GetContentDailyStatsUseCase) private readonly stats: GetContentDailyStatsUseCase,
    @Inject(GetCareerStatsUseCase) private readonly careerStats: GetCareerStatsUseCase,
    @Inject(GetContentRankingsUseCase) private readonly rankings: GetContentRankingsUseCase,
  ) {}

  @Get('posts')
  async listPostsByStatus(@Query(new ZodValidationPipe(postsByStatusQuery)) q: In<typeof postsByStatusQuery>) {
    return page(await this.postsByStatus.execute({ status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit }), presentModerationPost);
  }

  @Get('posts/:postId')
  async getPostInternal(@Param('postId', new ZodValidationPipe(uuidParam, 'postId')) postId: string) {
    return presentModerationPost(await this.getPost.execute({ postId }));
  }

  @Get('comments/:commentId')
  async getCommentInternal(@Param('commentId', new ZodValidationPipe(uuidParam, 'commentId')) commentId: string) {
    return presentComment(await this.getComment.execute({ commentId }));
  }

  @Patch('posts/:postId/status')
  @HttpCode(200)
  async updatePostStatus(
    @Param('postId', new ZodValidationPipe(uuidParam, 'postId')) postId: string,
    @Headers('x-actor-id') actorHeaderValue: string | undefined,
    @Body(new ZodValidationPipe(updatePostStatusBody)) body: In<typeof updatePostStatusBody>,
  ) {
    const actorId = actor.transform(actorHeaderValue);
    return presentPost(await this.updateStatus.execute({ postId, actorId, status: body.status, reason: body.reason }));
  }

  @Get('reports')
  async listContentReports(@Query(new ZodValidationPipe(reportsQuery)) q: In<typeof reportsQuery>) {
    return page(await this.reports.execute({ status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit }), presentReport);
  }

  @Patch('reports/:reportId')
  @HttpCode(200)
  async resolveContentReport(
    @Param('reportId', new ZodValidationPipe(uuidParam, 'reportId')) reportId: string,
    @Headers('x-actor-id') actorHeaderValue: string | undefined,
    @Body(new ZodValidationPipe(resolveReportBody)) body: In<typeof resolveReportBody>,
  ) {
    const actorId = actor.transform(actorHeaderValue);
    return presentReport(await this.resolve.execute({ reportId, actorId, resolution: body.resolution, note: body.note ?? null }));
  }

  @Get('profiles')
  async getProfileNamesInternal(@Query(new ZodValidationPipe(profileNamesQuery)) q: In<typeof profileNamesQuery>) {
    return { items: await this.profileNames.execute({ userIds: q.ids }) };
  }

  @Get('profiles/:userId')
  async getProfileInternal(@Param('userId', new ZodValidationPipe(uuidParam, 'userId')) userId: string) {
    return presentProfile(await this.profile.execute({ userId, viewerId: null }));
  }

  @Get('groups')
  async listGroupsInternal(@Query(new ZodValidationPipe(internalGroupsQuery)) q: In<typeof internalGroupsQuery>) {
    const offset = decodeOffset(q.cursor);
    const rows = await this.groups.execute({ ...(q.career ? { career: q.career } : {}), limit: q.limit + 1, offset });
    return { items: rows.slice(0, q.limit).map(presentGroup), nextCursor: encodeOffset(rows.length > q.limit ? offset + q.limit : null) };
  }

  @Get('stats/daily')
  async getContentDailyStats(@Query(new ZodValidationPipe(statsQuery)) q: In<typeof statsQuery>) {
    return presentStats(await this.stats.execute({ from: q.from, to: q.to, topHashtags: q.topHashtags }));
  }

  @Get('stats/careers')
  async getCareerStats(@Query(new ZodValidationPipe(careerStatsQuery)) q: In<typeof careerStatsQuery>) {
    return this.careerStats.execute({ limit: q.limit });
  }

  @Get('stats/rankings')
  async getContentRankings(@Query(new ZodValidationPipe(rankingsQuery)) q: In<typeof rankingsQuery>) {
    return this.rankings.execute({ from: q.from, to: q.to, by: q.by, limit: q.limit });
  }
}
