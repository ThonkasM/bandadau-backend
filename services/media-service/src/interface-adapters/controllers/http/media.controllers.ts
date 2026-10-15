import { CurrentUser, Internal, type RequestWithPrincipal, RequireScopes } from '@bandada/auth-ts/nest';
import { Idempotent } from '@bandada/idempotency-ts/nest';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { z } from 'zod';

import { DecideMediaUseCase } from '../../../use-cases/moderation/decide-media.use-case';
import { GetMediaInternalUseCase, GetMediaUrlsUseCase, GetMediaUseCase, ListFlaggedMediaUseCase } from '../../../use-cases/queries/media-queries.use-cases';
import { CompleteUploadUseCase } from '../../../use-cases/uploads/complete-upload.use-case';
import { CreateUploadUseCase } from '../../../use-cases/uploads/create-upload.use-case';
import { decodeCursor } from '../../presenters/cursor';
import { presentMedia, presentModerated, presentModeratedPage, presentTicket, presentUrl } from '../../presenters/media.presenter';
import { actorHeader, createUploadBody, decideBody, flaggedQuery, urlsQuery, uuidParam } from './dto/schemas';
import { ZodValidationPipe } from './dto/zod-validation.pipe';

type In<S extends z.ZodType> = z.output<S>;
const id = (name: string) => new ZodValidationPipe(uuidParam, name);

@Controller('api/v1/media')
export class MediaController {
  constructor(
    @Inject(CreateUploadUseCase) private readonly createUpload: CreateUploadUseCase,
    @Inject(CompleteUploadUseCase) private readonly completeUpload: CompleteUploadUseCase,
    @Inject(GetMediaUseCase) private readonly getMedia: GetMediaUseCase,
  ) {}

  @Post('uploads')
  @Idempotent()
  async upload(@CurrentUser('sub') ownerId: string, @Body(new ZodValidationPipe(createUploadBody)) body: In<typeof createUploadBody>) {
    return presentTicket(await this.createUpload.execute({ ownerId, ...body }));
  }

  @Post(':mediaId/complete')
  @HttpCode(202)
  async complete(@CurrentUser('sub') userId: string, @Param('mediaId', id('mediaId')) mediaId: string) {
    return presentMedia(await this.completeUpload.execute({ mediaId, userId }));
  }

  @Get(':mediaId')
  async get(@CurrentUser('sub') userId: string, @Param('mediaId', id('mediaId')) mediaId: string) {
    return presentMedia(await this.getMedia.execute({ mediaId, userId }));
  }
}

/** D-7 (seguridad-y-sso.md §2.1): GET -> `internal:read`, the rest -> `internal:write`. `INTERNAL_SCOPES_ENFORCED=false` disables it (escape hatch). */
const scope = (name: 'internal:read' | 'internal:write'): MethodDecorator => RequireScopes(...(process.env['INTERNAL_SCOPES_ENFORCED'] === 'false' ? [] : [name]));

/** Service-to-service API (`/internal/v1/media`). Static routes are declared before `:mediaId`. */
@Controller('internal/v1/media')
@Internal()
export class InternalMediaController {
  constructor(
    @Inject(ListFlaggedMediaUseCase) private readonly list: ListFlaggedMediaUseCase,
    @Inject(GetMediaUrlsUseCase) private readonly urls: GetMediaUrlsUseCase,
    @Inject(GetMediaInternalUseCase) private readonly getInternal: GetMediaInternalUseCase,
    @Inject(DecideMediaUseCase) private readonly decide: DecideMediaUseCase,
  ) {}

  @Get()
  @scope('internal:read')
  async listFlagged(@Query(new ZodValidationPipe(flaggedQuery)) q: In<typeof flaggedQuery>) {
    return presentModeratedPage(
      await this.list.execute({ status: q.status, ...(q.ownerId ? { ownerId: q.ownerId } : {}), ...(q.since ? { since: new Date(q.since) } : {}), cursor: decodeCursor(q.cursor), limit: q.limit }),
    );
  }

  @Get('urls')
  @scope('internal:read')
  async getUrls(@Query(new ZodValidationPipe(urlsQuery)) q: In<typeof urlsQuery>, @Req() req: RequestWithPrincipal) {
    const fromAdminGateway = req.user?.sub === 'admin-gateway' || req.user?.sub === 'service:admin-gateway';
    const items = await this.urls.execute({ ids: q.ids, includeUnapproved: q.includeUnapproved && fromAdminGateway });
    return { items: items.map(presentUrl) };
  }

  @Get(':mediaId')
  @scope('internal:read')
  async media(@Param('mediaId', id('mediaId')) mediaId: string) {
    return presentModerated(await this.getInternal.execute(mediaId));
  }

  @Post(':mediaId/decision')
  @scope('internal:write')
  @HttpCode(200)
  async decision(
    @Param('mediaId', id('mediaId')) mediaId: string,
    @Headers('x-actor-id') actorRaw: string | undefined,
    @Body(new ZodValidationPipe(decideBody)) body: In<typeof decideBody>,
  ) {
    const actorId = new ZodValidationPipe(actorHeader, 'X-Actor-Id').transform(actorRaw);
    return presentModerated(await this.decide.execute({ mediaId, actorId, decision: body.decision, note: body.note ?? null }));
  }
}
