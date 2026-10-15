import { Inject, Injectable, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';

import { HealthController } from '../../interface-adapters/controllers/http/health.controller';
import { InternalMediaController, MediaController } from '../../interface-adapters/controllers/http/media.controllers';
import { PostEventsConsumer } from '../../interface-adapters/controllers/messaging/post-events.consumer';
import { MongoContext } from '../../interface-adapters/gateways/mongo/mongo-context';
import { MongoMediaRepository } from '../../interface-adapters/gateways/mongo/mongo-media.repository';
import type { JsonLogger } from '../../interface-adapters/logger';
import { newRequestContext, requestContext } from '../../interface-adapters/request-context';
import { DecideMediaUseCase } from '../../use-cases/moderation/decide-media.use-case';
import { ProcessMediaUseCase, RequeueStaleProcessingUseCase } from '../../use-cases/moderation/process-media.use-case';
import { CLOCK, EVENT_PUBLISHER, ID_GENERATOR, MEDIA_REPOSITORY, MODERATION_PORT, OBJECT_STORAGE, THUMBNAIL_GENERATOR, UNIT_OF_WORK } from '../../use-cases/ports';
import { OnPostDeletedUseCase, PurgeStaleUploadsUseCase } from '../../use-cases/post-events.use-case';
import { GetMediaInternalUseCase, GetMediaUrlsUseCase, GetMediaUseCase, ListFlaggedMediaUseCase } from '../../use-cases/queries/media-queries.use-cases';
import { CompleteUploadUseCase, PROCESSING_QUEUE, type ProcessingQueue } from '../../use-cases/uploads/complete-upload.use-case';
import { CreateUploadUseCase } from '../../use-cases/uploads/create-upload.use-case';
import type { Env } from '../config/env';
import { ENV, LOGGER } from './tokens';

type Token = symbol | (new (...args: never[]) => unknown);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function factory<C extends new (...args: any[]) => unknown>(cls: C, ...deps: Token[]) {
  return { provide: cls, inject: deps as never[], useFactory: (...args: ConstructorParameters<C>) => new cls(...args) };
}

/** In-process worker for the phase-1 moderation step plus the maintenance sweepers (stuck PROCESSING, stale uploads). */
@Injectable()
class ProcessingWorker implements ProcessingQueue, OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private readonly inFlight = new Set<string>();

  constructor(
    @Inject(ProcessMediaUseCase) private readonly process: ProcessMediaUseCase,
    @Inject(RequeueStaleProcessingUseCase) private readonly requeue: RequeueStaleProcessingUseCase,
    @Inject(PurgeStaleUploadsUseCase) private readonly purge: PurgeStaleUploadsUseCase,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: JsonLogger,
  ) {}

  enqueue(assetId: string): void {
    if (this.inFlight.has(assetId)) return;
    this.inFlight.add(assetId);
    setImmediate(() => {
      requestContext
        .run(newRequestContext({ fallbackCorrelationId: assetId }), () => this.process.execute(assetId))
        .catch((error: unknown) => this.logger.error('media processing failed', { assetId, err: String(error) }))
        .finally(() => this.inFlight.delete(assetId));
    });
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.requeue.execute(this.env.STALE_PROCESSING_MS).then((ids) => ids.forEach((id) => this.enqueue(id))).catch(() => undefined);
      void this.purge.execute().catch(() => undefined);
    }, this.env.STALE_PROCESSING_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

@Module({
  controllers: [HealthController, MediaController, InternalMediaController],
  providers: [
    { provide: MEDIA_REPOSITORY, inject: [MongoContext], useFactory: (ctx: MongoContext) => new MongoMediaRepository(ctx) },
    ProcessingWorker,
    { provide: PROCESSING_QUEUE, useExisting: ProcessingWorker },
    {
      provide: CreateUploadUseCase,
      inject: [MEDIA_REPOSITORY, OBJECT_STORAGE, ID_GENERATOR, CLOCK, ENV],
      useFactory: (...a: [never, never, never, never, Env]) => new CreateUploadUseCase(a[0], a[1], a[2], a[3], { maxImageBytes: a[4].MAX_IMAGE_BYTES, maxVideoBytes: a[4].MAX_VIDEO_BYTES }, a[4].UPLOAD_URL_TTL_SECONDS),
    },
    factory(CompleteUploadUseCase, MEDIA_REPOSITORY, OBJECT_STORAGE, PROCESSING_QUEUE, CLOCK),
    factory(GetMediaUseCase, MEDIA_REPOSITORY, OBJECT_STORAGE),
    factory(GetMediaInternalUseCase, MEDIA_REPOSITORY, OBJECT_STORAGE),
    factory(GetMediaUrlsUseCase, MEDIA_REPOSITORY, OBJECT_STORAGE, CLOCK),
    factory(ListFlaggedMediaUseCase, MEDIA_REPOSITORY, OBJECT_STORAGE),
    factory(DecideMediaUseCase, MEDIA_REPOSITORY, OBJECT_STORAGE, EVENT_PUBLISHER, UNIT_OF_WORK, CLOCK),
    factory(ProcessMediaUseCase, MEDIA_REPOSITORY, MODERATION_PORT, THUMBNAIL_GENERATOR, EVENT_PUBLISHER, UNIT_OF_WORK, CLOCK, OBJECT_STORAGE),
    factory(RequeueStaleProcessingUseCase, MEDIA_REPOSITORY, CLOCK),
    factory(OnPostDeletedUseCase, MEDIA_REPOSITORY, OBJECT_STORAGE),
    { provide: PurgeStaleUploadsUseCase, inject: [MEDIA_REPOSITORY, OBJECT_STORAGE, CLOCK], useFactory: (m: never, s: never, c: { now(): Date }) => new PurgeStaleUploadsUseCase(m, s, () => c.now()) },
    PostEventsConsumer,
  ],
})
export class MediaModule {}
