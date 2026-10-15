import { createProblem, type ProblemDetails } from '@bandada/contracts-ts/problem';
import type { Locale } from '@bandada/i18n';

import { type DomainError, RateLimitedError, ValidationError } from '../../entities/errors/domain-errors';
import { PROBLEM_MESSAGES, PROBLEM_STATUS } from './problem-messages';

export interface ProblemContext {
  locale: Locale;
  instance?: string;
  traceId?: string;
}

export function problemFor(code: string, ctx: ProblemContext, params: Record<string, string> = {}, extensions: Record<string, unknown> = {}): ProblemDetails {
  const message = PROBLEM_MESSAGES[code] ?? (PROBLEM_MESSAGES.INTERNAL_ERROR as (typeof PROBLEM_MESSAGES)[string]);
  return createProblem({
    status: PROBLEM_STATUS[code] ?? 500,
    code,
    title: message.title[ctx.locale],
    detail: message.detail[ctx.locale](params),
    instance: ctx.instance,
    traceId: ctx.traceId,
    ...extensions,
  });
}

/** Domain error -> localized RFC 9457 body. Stable `code`; unknown domain codes become INTERNAL_ERROR. */
export function problemFromDomainError(error: DomainError, ctx: ProblemContext): ProblemDetails {
  if (error instanceof ValidationError) return problemFor('VALIDATION_FAILED', ctx, {}, { errors: error.errors.length ? error.errors : [{ field: '', code: 'INVALID_VALUE', message: error.message }] });
  if (error instanceof RateLimitedError) return problemFor('RATE_LIMITED', ctx, { retryAfterSec: String(error.retryAfterSec) }, { retryAfterSec: String(error.retryAfterSec) });
  return problemFor(error.code in PROBLEM_STATUS ? error.code : 'INTERNAL_ERROR', ctx);
}
