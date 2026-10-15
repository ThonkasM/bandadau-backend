import { AuthModule, JwtAuthGuard, RolesGuard } from '@bandada/auth-ts/nest';
import { IdempotencyInterceptor, IdempotencyModule } from '@bandada/idempotency-ts/nest';
import { MessagingModule } from '@bandada/messaging-ts/nest';
import { DomainError } from '../entities/errors/domain-error';
import { type DynamicModule, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { MongoInbox, MongoOutbox } from '@bandada/messaging-ts';

import { requestContextMiddleware } from '../interface-adapters/controllers/http/request-context.middleware';
import { RATE_LIMIT_OPTIONS, RateLimitGuard } from '../interface-adapters/controllers/http/rate-limit.guard';
import { SOCIAL_QUEUE } from '../interface-adapters/controllers/messaging/events.consumers';
import type { JsonLogger } from '../interface-adapters/logger';
import { domainErrorBody } from '../interface-adapters/presenters/problem-details';
import { LOGGER_TOKEN, ProblemDetailsFilter } from '../interface-adapters/presenters/problem-details.filter';
import type { Env } from './config/env';
import { createDynamoDocClient } from './database/dynamo';
import { InfrastructureModule } from './modules/infrastructure.module';
import { SocialModule } from './modules/social.module';
import { LOGGER, MONGO_INBOX, MONGO_OUTBOX } from './modules/tokens';

@Module({})
export class AppModule implements NestModule {
  private static env: Env;
  private static logger: JsonLogger;

  static forRoot(env: Env, logger: JsonLogger): DynamicModule {
    AppModule.env = env;
    AppModule.logger = logger;
    const infra = InfrastructureModule.forRoot(env);
    return {
      module: AppModule,
      imports: [
        infra,
        AuthModule.forRoot({
          jwksUrl: env.JWKS_URL,
          issuer: env.JWT_ISSUER,
          serviceToken: { tokenUrl: `${env.IDENTITY_URL.replace(/\/$/, '')}/api/v1/auth/service-token`, clientId: env.SERVICE_CLIENT_ID, clientSecret: env.SERVICE_CLIENT_SECRET },
        }),
        IdempotencyModule.forRoot({
          service: 'social-service',
          tableName: env.IDEMPOTENCY_TABLE,
          client: createDynamoDocClient(env),
          mapError: (error) => (error instanceof DomainError ? domainErrorBody(error) : undefined),
        }),
        ...(env.MESSAGING_ENABLED
          ? [
              MessagingModule.forRootAsync({
                imports: [infra],
                inject: [MONGO_INBOX, MONGO_OUTBOX, LOGGER],
                useFactory: (inbox: MongoInbox, outbox: MongoOutbox, log: JsonLogger) => ({
                  rabbit: { url: env.RABBITMQ_URL },
                  queues: { [SOCIAL_QUEUE]: { inbox, topology: 'verify' as const } },
                  relay: { outbox, pollIntervalMs: env.OUTBOX_POLL_MS },
                  logger: log,
                }),
              }),
            ]
          : []),
        SocialModule,
      ],
      providers: [
        { provide: LOGGER_TOKEN, useExisting: LOGGER },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: RATE_LIMIT_OPTIONS, useValue: { perMinute: env.RATE_LIMIT_PER_MINUTE } },
        { provide: APP_GUARD, useExisting: JwtAuthGuard },
        { provide: APP_GUARD, useExisting: RolesGuard },
        { provide: APP_GUARD, useFactory: () => new RateLimitGuard({ perMinute: env.RATE_LIMIT_PER_MINUTE }) },
        { provide: APP_INTERCEPTOR, useExisting: IdempotencyInterceptor },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestContextMiddleware(AppModule.logger, AppModule.env.DEFAULT_LOCALE)).forRoutes('*path');
  }
}
