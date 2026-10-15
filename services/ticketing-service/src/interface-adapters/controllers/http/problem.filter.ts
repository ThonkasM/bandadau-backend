import { isProblem } from '@bandada/contracts-ts/problem';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { problemFor } from '../../presenters/problem.presenter';
import { localeOf, traceIdOf } from './http-problem';

const CODE_BY_STATUS: Record<number, string> = { 400: 'MALFORMED_REQUEST', 404: 'NOT_FOUND', 503: 'SERVICE_UNAVAILABLE' };

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const ctx = { locale: localeOf(req), instance: (req.originalUrl ?? req.url).split('?')[0], traceId: traceIdOf(req) };

    let status = 500;
    let body: unknown;
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      body = isProblem(payload) ? { instance: ctx.instance, ...payload } : problemFor(CODE_BY_STATUS[status] ?? 'INTERNAL_ERROR', ctx);
    } else {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
      body = problemFor('INTERNAL_ERROR', ctx);
    }
    res.status(status).type('application/problem+json').json(body);
  }
}
