import type { ProblemDetails } from '@bandada/contracts-ts/problem';
import { type Locale, resolveLocaleFromAcceptLanguage } from '@bandada/i18n';
import { HttpException } from '@nestjs/common';

import { DomainError } from '../../../entities/errors/domain-errors';
import { problemFor, problemFromDomainError } from '../../presenters/problem.presenter';

export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  originalUrl?: string;
  url?: string;
}

export const localeOf = (req: RequestLike): Locale => {
  const h = req.headers['accept-language'];
  return resolveLocaleFromAcceptLanguage(Array.isArray(h) ? h[0] : h);
};
export const traceIdOf = (req: RequestLike): string | undefined => {
  const t = req.headers['traceparent'];
  return (Array.isArray(t) ? t[0] : t)?.split('-')[1];
};
export const ctxOf = (req: RequestLike) => ({ locale: localeOf(req), instance: (req.originalUrl ?? req.url ?? '').split('?')[0], traceId: traceIdOf(req) });

export class ProblemHttpException extends HttpException {
  constructor(readonly problem: ProblemDetails) {
    super(problem, problem.status);
  }
}

/** Domain error -> HttpException with a Problem Details body (so the idempotency store can keep it). */
export function toHttpProblem(error: unknown, req: RequestLike): unknown {
  return error instanceof DomainError ? new ProblemHttpException(problemFromDomainError(error, ctxOf(req))) : error;
}

export function validationProblem(req: RequestLike, errors: { field: string; code: string; message: string }[]): ProblemHttpException {
  return new ProblemHttpException({ ...problemFor('VALIDATION_FAILED', ctxOf(req)), errors });
}
