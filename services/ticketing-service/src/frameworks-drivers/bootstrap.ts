import { resolveLocaleFromAcceptLanguage } from '@bandada/i18n';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

import type { AppConfig } from './config/app-config';

/** Shared by `main.ts` and the e2e tests so both run the same HTTP pipeline. */
export function configureApp(app: INestApplication, config: Pick<AppConfig, 'corsOrigins'>): void {
  const express = app as NestExpressApplication;
  express.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  express.use((req: { headers: Record<string, string | undefined> }, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader('Content-Language', resolveLocaleFromAcceptLanguage(req.headers['accept-language']));
    next();
  });
  express.enableShutdownHooks();
  if (config.corsOrigins.length > 0) {
    express.enableCors({
      origin: config.corsOrigins,
      credentials: true,
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'Accept-Language', 'X-Correlation-Id', 'traceparent'],
      exposedHeaders: ['Idempotent-Replayed', 'Content-Language', 'Retry-After'],
    });
  }
}
