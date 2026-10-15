import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { EVENT_BUS, GRAPHQL_SERVER } from './app.module';
import type { GatewayConfig } from './config/env';
import type { GraphqlServer } from './graphql/graphql-server';
import type { RabbitEventBus } from './graphql/pubsub/rabbit-event-bus';

/** Shared by `main.ts` and the tests. Must run before `app.init()`/`listen()` so the GraphQL routes precede Nest's 404 handler. */
export async function configureApp(app: INestApplication, config: GatewayConfig): Promise<void> {
  const express = app as NestExpressApplication;
  express.enableShutdownHooks();
  express.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept-Language', 'X-Correlation-Id', 'Apollo-Require-Preflight'],
    exposedHeaders: ['Content-Language'],
  });
  const server = app.get<GraphqlServer>(GRAPHQL_SERVER);
  await server.mount(express.getHttpAdapter().getInstance(), app.getHttpServer());
  app.get<RabbitEventBus>(EVENT_BUS).start();
}
