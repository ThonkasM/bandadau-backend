import { MongoInbox, MongoOutbox } from '@bandada/messaging-ts';
import { type DynamicModule, Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { MongoClient } from 'mongodb';

import { OutboxEventPublisher } from '../../interface-adapters/gateways/messaging/outbox-event-publisher';
import { Phase1ModerationAdapter } from '../../interface-adapters/gateways/moderation/phase1-moderation.adapters';
import { MongoContext, MongoUnitOfWork } from '../../interface-adapters/gateways/mongo/mongo-context';
import { S3ObjectStorage } from '../../interface-adapters/gateways/s3/s3-object-storage';
import { SystemClock, UuidV7Generator } from '../../interface-adapters/gateways/system';
import { JsonLogger } from '../../interface-adapters/logger';
import { CLOCK, EVENT_PUBLISHER, ID_GENERATOR, MODERATION_PORT, OBJECT_STORAGE, THUMBNAIL_GENERATOR, UNIT_OF_WORK } from '../../use-cases/ports';
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
        { provide: MODERATION_PORT, useValue: new Phase1ModerationAdapter(env.MODERATION_MODE) },
        { provide: CLOCK, useClass: SystemClock },
        { provide: ID_GENERATOR, useClass: UuidV7Generator },
        InfrastructureLifecycle,
      ],
      exports: [ENV, LOGGER, MongoContext, MONGO_OUTBOX, MONGO_INBOX, UNIT_OF_WORK, EVENT_PUBLISHER, OBJECT_STORAGE, THUMBNAIL_GENERATOR, MODERATION_PORT, CLOCK, ID_GENERATOR],
    };
  }
}
