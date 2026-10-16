import { MongoInbox, MongoOutbox } from '@bandada/messaging-ts';
import { type DynamicModule, Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { MongoClient } from 'mongodb';

import { OutboxEventPublisher } from '../../interface-adapters/gateways/messaging/outbox-event-publisher';
import { FfmpegFrameExtractor } from '../../interface-adapters/gateways/moderation/ffmpeg-frame-extractor';
import { OnnxModerationAdapter } from '../../interface-adapters/gateways/moderation/onnx-moderation.adapter';
import { Phase1ModerationAdapter } from '../../interface-adapters/gateways/moderation/phase1-moderation.adapters';
import { S3ModelRegistry } from '../../interface-adapters/gateways/moderation/s3-model-registry';
import { MongoContext, MongoUnitOfWork } from '../../interface-adapters/gateways/mongo/mongo-context';
import { S3ObjectStorage } from '../../interface-adapters/gateways/s3/s3-object-storage';
import { SystemClock, UuidV7Generator } from '../../interface-adapters/gateways/system';
import { JsonLogger } from '../../interface-adapters/logger';
import { CLOCK, EVENT_PUBLISHER, ID_GENERATOR, MODERATION_PORT, type ModerationPort, OBJECT_STORAGE, THUMBNAIL_GENERATOR, UNIT_OF_WORK } from '../../use-cases/ports';
import type { Env } from '../config/env';
import { ensureIndexes } from '../database/indexes';
import { ENV, LOGGER, MONGO_INBOX, MONGO_OUTBOX } from './tokens';

@Injectable()
class InfrastructureLifecycle implements OnApplicationShutdown {
  constructor(@Inject(MongoContext) private readonly mongo: MongoContext) {}
  async onApplicationShutdown(): Promise<void> {
    await this.mongo.client.close();
  }
}

/** Connections and technical adapters (Mongo, S3, outbox, moderation, clock, ids). */
@Global()
@Module({})
export class InfrastructureModule {
  static forRoot(env: Env): DynamicModule {
    const s3 = new S3ObjectStorage({
      endpoint: env.S3_ENDPOINT,
      publicEndpoint: env.S3_PUBLIC_ENDPOINT,
      region: env.AWS_REGION,
      bucket: env.S3_BUCKET_MEDIA,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
    return {
      module: InfrastructureModule,
      providers: [
        { provide: ENV, useValue: env },
        { provide: LOGGER, useValue: new JsonLogger('media-service', env.LOG_LEVEL) },
        {
          provide: MongoContext,
          useFactory: async (): Promise<MongoContext> => {
            const client = new MongoClient(env.MONGODB_URI, { maxPoolSize: 20, serverSelectionTimeoutMS: 15_000 });
            await client.connect();
            const db = client.db();
            await ensureIndexes(db);
            return new MongoContext(client, db);
          },
        },
        {
          provide: MONGO_OUTBOX,
          inject: [MongoContext],
          useFactory: async (ctx: MongoContext): Promise<MongoOutbox> => {
            const outbox = new MongoOutbox({ db: ctx.db });
            await outbox.ensureIndexes();
            return outbox;
          },
        },
        {
          provide: MONGO_INBOX,
          inject: [MongoContext],
          useFactory: async (ctx: MongoContext): Promise<MongoInbox> => {
            const inbox = new MongoInbox({ client: ctx.client, db: ctx.db });
            await inbox.ensureIndexes();
            return inbox;
          },
        },
        { provide: UNIT_OF_WORK, inject: [MongoContext], useFactory: (ctx: MongoContext) => new MongoUnitOfWork(ctx) },
        { provide: EVENT_PUBLISHER, inject: [MongoContext, MONGO_OUTBOX], useFactory: (ctx: MongoContext, outbox: MongoOutbox) => new OutboxEventPublisher(ctx, outbox, 'media-service') },
        { provide: OBJECT_STORAGE, useValue: s3 },
        { provide: THUMBNAIL_GENERATOR, useValue: s3 },
        {
          provide: MODERATION_PORT,
          inject: [LOGGER],
          useFactory: async (logger: JsonLogger): Promise<ModerationPort> => {
            if (env.MODERATION_MODE !== 'onnx') return new Phase1ModerationAdapter(env.MODERATION_MODE);
            const registry = new S3ModelRegistry({
              endpoint: env.S3_ENDPOINT,
              region: env.AWS_REGION,
              bucket: env.MODEL_BUCKET ?? env.S3_BUCKET_MODELS,
              accessKeyId: env.S3_ACCESS_KEY_ID,
              secretAccessKey: env.S3_SECRET_ACCESS_KEY,
              forcePathStyle: env.S3_FORCE_PATH_STYLE,
              cacheDir: env.MODEL_CACHE_DIR,
            });
            const frames = new FfmpegFrameExtractor({ ffmpegPath: env.FFMPEG_PATH, ffprobePath: env.FFPROBE_PATH, intervalSeconds: env.VIDEO_FRAME_INTERVAL_SECONDS, maxFrames: env.VIDEO_MAX_FRAMES, timeoutMs: 60_000 });
            const adapter = new OnnxModerationAdapter(
              registry,
              s3,
              frames,
              {
                modelName: env.MODEL_NAME,
                modelVersion: env.MODEL_VERSION ?? env.MODEL_NSFW_VERSION,
                variant: env.MODEL_VARIANT,
                threads: env.ORT_THREADS,
                blockThreshold: env.MODERATION_BLOCK_THRESHOLD,
                reviewThreshold: env.MODERATION_REVIEW_THRESHOLD,
                maxVideoSeconds: env.VIDEO_MAX_SECONDS,
                frameIntervalSeconds: env.VIDEO_FRAME_INTERVAL_SECONDS,
                retryMs: env.MODEL_RETRY_MS,
              },
              logger,
            );
            await adapter.init();
            return adapter;
          },
        },
        { provide: CLOCK, useClass: SystemClock },
        { provide: ID_GENERATOR, useClass: UuidV7Generator },
        InfrastructureLifecycle,
      ],
      exports: [ENV, LOGGER, MongoContext, MONGO_OUTBOX, MONGO_INBOX, UNIT_OF_WORK, EVENT_PUBLISHER, OBJECT_STORAGE, THUMBNAIL_GENERATOR, MODERATION_PORT, CLOCK, ID_GENERATOR],
    };
  }
}
