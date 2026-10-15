import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Inject, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { DomainError } from '../../entities/errors/domain-error';
import { newRequestContext, requestContext } from '../request-context';
import { buildProblem, DOMAIN_STATUS, type BuildProblemInput, type Locale } from './problem-details';

export const LOGGER_TOKEN = Symbol('JsonLogger');

interface StructuredBody {
  code?: string;
  errors?: BuildProblemInput['errors'];
  params?: Record<string, unknown>;
}

const GENERIC_CODE: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  413: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

/** Global RFC 9457 translator: DomainError + HttpException (guards, pipes, shared libs) -> localized `application/problem+json`. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  constructor(@Inject(LOGGER_TOKEN) private readonly app: { error(message: string, context?: Record<string, unknown>): void }) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const rc = requestContext.get() ?? newRequestContext({ fallbackCorrelationId: 'unknown' });
    const locale: Locale = rc.locale;
    const base = { locale, instance: req.originalUrl?.split('?')[0], traceId: rc.traceId };

    let status = 500;
    let input: BuildProblemInput = { ...base, status, code: 'INTERNAL_ERROR' };
    let retryAfter: string | undefined;

    if (exception instanceof DomainError) {
      status = DOMAIN_STATUS[exception.code];
      const field = exception.meta.field as string | undefined;
      input = {
        ...base,
        status,
        code: exception.code,
        ...(exception.code === 'VALIDATION_FAILED' && field ? { errors: [{ field, pointer: `/${field}`, code: String(exception.meta.code ?? 'INVALID_VALUE') }] } : {}),
      };
      if (status === 503) retryAfter = '5';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      const structured: StructuredBody = typeof body === 'object' && body !== null ? (body as StructuredBody) : {};
      const code = typeof structured.code === 'string' ? structured.code : (GENERIC_CODE[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED'));
      input = { ...base, status, code, ...(structured.errors ? { errors: structured.errors } : {}), ...(structured.params ? { params: structured.params } : {}) };
      if (status === 409 && code === 'IDEMPOTENCY_IN_PROGRESS') retryAfter = '1';
      const headers = (exception as HttpException & { headers?: Record<string, string> }).headers;
      if (headers?.['retry-after']) retryAfter = headers['retry-after'];
    } else {
      this.app.error('unhandled exception', { err: exception instanceof Error ? { name: exception.name, message: exception.message, stack: exception.stack } : String(exception) });
    }

    const problem = buildProblem(input);
    if (retryAfter) res.setHeader('Retry-After', retryAfter);
    res.setHeader('Content-Language', locale);
    res.setHeader('X-Correlation-Id', rc.correlationId);
    res.status(status).type('application/problem+json').send(problem);
  }
}
