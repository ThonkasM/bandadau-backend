import type { ProblemDetails } from '@bandada/contracts-ts/problem';
import { type Locale,resolveLocaleFromAcceptLanguage } from '@bandada/i18n';
import { HttpException } from '@nestjs/common';

import { DomainError } from '../../../entities/errors/domain-errors';
import { problemFor, problemFromDomainError } from '../../presenters/problem.presenter';

export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  originalUrl?: string;
  url?: string;
}

export const localeOf = (req: RequestLike): Locale => {
  const header = req.headers['accept-language'];
  return resolveLocaleFromAcceptLanguage(Array.isArray(header) ? header[0] : header);
};

export const traceIdOf = (req: RequestLike): string | undefined => {
  const traceparent = req.headers['traceparent'];
  const value = Array.isArray(traceparent) ? traceparent[0] : traceparent;
  return value?.split('-')[1];
};

export class ProblemHttpException extends HttpException {
  constructor(readonly problem: ProblemDetails) {
    super(problem, problem.status);
  }
}

/** Domain error -> HttpException carrying a localized Problem Details body (so idempotency can store it). */
export function toHttpProblem(error: unknown, req: RequestLike): unknown {
  const ctx = { locale: localeOf(req), instance: (req.originalUrl ?? req.url ?? '').split('?')[0], traceId: traceIdOf(req) };
  if (error instanceof DomainError) return new ProblemHttpException(problemFromDomainError(error, ctx));
  return error;
}

export function validationProblem(req: RequestLike, errors: { field: string; code: string; message: string }[]): ProblemHttpException {
  const ctx = { locale: localeOf(req), instance: (req.originalUrl ?? req.url ?? '').split('?')[0], traceId: traceIdOf(req) };
  return new ProblemHttpException({ ...problemFor('VALIDATION_FAILED', ctx), errors });
}
