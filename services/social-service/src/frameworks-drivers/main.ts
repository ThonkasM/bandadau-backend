import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { JsonLogger } from '../interface-adapters/logger';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ level: 'error', service: 'social-service', msg: String((error as Error).message) })}\n`);
    process.exit(1);
  }
  const logger = new JsonLogger('social-service', env.LOG_LEVEL);
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env, logger), { logger, bufferLogs: false });
  app.set('trust proxy', true);
  app.use(helmet());
  app.useBodyParser('json', { limit: '256kb' });
  app.enableCors({
    origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'Accept-Language', 'X-Correlation-Id'],
    exposedHeaders: ['Idempotent-Replayed', 'Content-Language', 'X-Correlation-Id', 'Retry-After'],
    maxAge: 600,
  });
  app.enableShutdownHooks();
  await app.listen(env.PORT, '0.0.0.0');
  logger.info('social-service listening', { port: env.PORT });
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ level: 'error', service: 'social-service', msg: 'bootstrap failed', err: String(error) })}\n`);
  process.exit(1);
});
