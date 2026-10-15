import { isProblem } from '@bandada/contracts-ts/problem';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { problemFor } from '../../presenters/problem.presenter';
import { ctxOf } from './http-problem';

const CODE_BY_STATUS: Record<number, string> = { 400: 'MALFORMED_REQUEST', 404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED', 413: 'PAYLOAD_TOO_LARGE', 503: 'SERVICE_UNAVAILABLE' };

const isHttpError = (e: unknown): e is { status?: number; statusCode?: number } => {
  const x = e as { status?: unknown; statusCode?: unknown; expose?: unknown } | null;
  const code = typeof x?.status === 'number' ? x.status : typeof x?.statusCode === 'number' ? x.statusCode : 0;
  return code >= 400 && code < 500 && x?.expose === true;
};

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const ctx = ctxOf(req);
    let status = 500;
    let body: unknown;
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      body = isProblem(payload) ? { instance: ctx.instance, ...payload } : problemFor(CODE_BY_STATUS[status] ?? 'INTERNAL_ERROR', ctx);
    } else if (isHttpError(exception)) {
      // body-parser / express errors (413 too large, 400 malformed JSON): client errors, not crashes
      status = exception.status ?? exception.statusCode ?? 400;
      body = problemFor(CODE_BY_STATUS[status] ?? 'MALFORMED_REQUEST', ctx);
    } else {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
      body = problemFor('INTERNAL_ERROR', ctx);
    }
    const retry = (body as { retryAfterSec?: string }).retryAfterSec;
    if (status === 429 && retry) res.setHeader('Retry-After', retry);
    res.status(status).type('application/problem+json').json(body);
  }
}
