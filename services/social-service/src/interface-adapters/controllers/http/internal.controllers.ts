import { Internal } from '@bandada/auth-ts/nest';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Patch, Query } from '@nestjs/common';
import type { z } from 'zod';

import { ListGroupsInternalUseCase } from '../../../use-cases/groups/group.use-cases';
import { GetProfileUseCase } from '../../../use-cases/profiles/profile.use-cases';
import { GetContentDailyStatsUseCase } from '../../../use-cases/reports/daily-stats.use-case';
import {
  ListContentReportsUseCase,
  ListPostsByStatusUseCase,
  ResolveContentReportUseCase,
  UpdatePostStatusUseCase,
} from '../../../use-cases/reports/moderation.use-cases';
import { decodeCursor, decodeOffset, encodeOffset } from '../../presenters/cursor';
import { page, presentGroup, presentModerationPost, presentPost, presentProfile, presentReport, presentStats } from '../../presenters/resource.presenter';
import {
  actorHeader,
  internalGroupsQuery,
  postsByStatusQuery,
  reportsQuery,
  resolveReportBody,
  statsQuery,
  updatePostStatusBody,
  uuidParam,
} from './dto/schemas';
import { ZodValidationPipe } from './dto/zod-validation.pipe';

type In<S extends z.ZodType> = z.output<S>;
const actor = new ZodValidationPipe(actorHeader, 'X-Actor-Id');

/** Service-to-service API (`/internal/v1`), blocked at Traefik and guarded with a service token. */
@Controller('internal/v1')
@Internal()
export class InternalController {
  constructor(
    @Inject(ListPostsByStatusUseCase) private readonly postsByStatus: ListPostsByStatusUseCase,
    @Inject(UpdatePostStatusUseCase) private readonly updateStatus: UpdatePostStatusUseCase,
    @Inject(ListContentReportsUseCase) private readonly reports: ListContentReportsUseCase,
    @Inject(ResolveContentReportUseCase) private readonly resolve: ResolveContentReportUseCase,
    @Inject(GetProfileUseCase) private readonly profile: GetProfileUseCase,
    @Inject(ListGroupsInternalUseCase) private readonly groups: ListGroupsInternalUseCase,
    @Inject(GetContentDailyStatsUseCase) private readonly stats: GetContentDailyStatsUseCase,
  ) {}

  @Get('posts')
  async listPostsByStatus(@Query(new ZodValidationPipe(postsByStatusQuery)) q: In<typeof postsByStatusQuery>) {
    return page(await this.postsByStatus.execute({ status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit }), presentModerationPost);
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
}
