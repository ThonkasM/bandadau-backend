import { randomUUID } from 'node:crypto';

import { uuidv7 } from '@bandada/messaging-ts';
import { resolveLocaleFromAcceptLanguage } from '@bandada/i18n';
import type { NextFunction, Request, Response } from 'express';

import type { JsonLogger } from '../../logger';
import { newRequestContext, requestContext } from '../../request-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** correlationId (`X-Correlation-Id`), W3C trace and negotiated locale for the whole request; JSON access log on finish. */
export function requestContextMiddleware(logger: JsonLogger, defaultLocale: 'es' | 'en') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('x-correlation-id');
    const ctx = newRequestContext({
      ...(header && UUID.test(header) ? { correlationId: header } : {}),
      fallbackCorrelationId: uuidv7(),
      ...(req.header('traceparent') ? { traceparent: req.header('traceparent') as string } : {}),
      locale: req.header('accept-language') ? resolveLocaleFromAcceptLanguage(req.header('accept-language')) : defaultLocale,
    });
    res.setHeader('X-Correlation-Id', ctx.correlationId);
    res.setHeader('Content-Language', ctx.locale);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      if (req.path.startsWith('/health')) return;
      requestContext.run(ctx, () =>
        logger.info('http request', { method: req.method, path: req.path, status: res.statusCode, durationMs: Number(process.hrtime.bigint() - started) / 1e6, requestId: randomUUID().slice(0, 8) }),
      );
    });
    requestContext.run(ctx, next);
  };
}
