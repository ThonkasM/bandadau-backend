import type { ServiceTokenProvider } from '@bandada/auth-ts';
import { SERVICE_TOKEN_PROVIDER } from '@bandada/auth-ts/nest';
import { MongoInbox, MongoOutbox } from '@bandada/messaging-ts';
import { type DynamicModule, Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { MongoClient } from 'mongodb';

import { OutboxEventPublisher } from '../../interface-adapters/gateways/messaging/outbox-event-publisher';
import { MediaHttpGateway } from '../../interface-adapters/gateways/http/media-http.gateway';
import { MongoContext, MongoUnitOfWork } from '../../interface-adapters/gateways/mongo/mongo-context';
import { JsonLogger } from '../../interface-adapters/logger';
import { SystemClock, UuidV7Generator } from '../../interface-adapters/gateways/system';
import { CLOCK, EVENT_PUBLISHER, ID_GENERATOR, MEDIA_GATEWAY, UNIT_OF_WORK } from '../../use-cases/ports';
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

/** Connections and technical adapters (Mongo, DynamoDB, outbox, media-service client, clock, ids). */
@Global()
@Module({})
export class InfrastructureModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: InfrastructureModule,
      providers: [
        { provide: ENV, useValue: env },
        { provide: LOGGER, useValue: new JsonLogger('social-service', env.LOG_LEVEL) },
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
        { provide: EVENT_PUBLISHER, inject: [MongoContext, MONGO_OUTBOX], useFactory: (ctx: MongoContext, outbox: MongoOutbox) => new OutboxEventPublisher(ctx, outbox, 'social-service') },
        { provide: CLOCK, useClass: SystemClock },
        { provide: ID_GENERATOR, useClass: UuidV7Generator },
        {
          provide: MEDIA_GATEWAY,
          inject: [SERVICE_TOKEN_PROVIDER],
          useFactory: (tokens: ServiceTokenProvider) => new MediaHttpGateway({ baseUrl: env.MEDIA_SERVICE_URL.replace(/\/$/, ''), tokens, timeoutMs: env.MEDIA_HTTP_TIMEOUT_MS }),
        },
        InfrastructureLifecycle,
      ],
      exports: [ENV, LOGGER, MongoContext, MONGO_OUTBOX, MONGO_INBOX, UNIT_OF_WORK, EVENT_PUBLISHER, CLOCK, ID_GENERATOR, MEDIA_GATEWAY],
    };
  }
}
