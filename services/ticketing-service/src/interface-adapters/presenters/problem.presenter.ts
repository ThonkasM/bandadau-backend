import { createProblem, type ProblemDetails } from '@bandada/contracts-ts/problem';
import type { Locale } from '@bandada/i18n';
import { formatDateTime } from '@bandada/i18n/format';

import {
  type DomainError,
  TicketAlreadyUsedError,
  ValidationWindowClosedError,
} from '../../entities/errors/domain-errors';
import { PROBLEM_MESSAGES, PROBLEM_STATUS } from './problem-messages';

export interface ProblemContext {
  locale: Locale;
  instance?: string;
  traceId?: string;
}

export function problemFor(code: string, ctx: ProblemContext, params: Record<string, string> = {}, extensions: Record<string, unknown> = {}): ProblemDetails {
  const message = PROBLEM_MESSAGES[code] ?? PROBLEM_MESSAGES.INTERNAL_ERROR!;
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

/** Maps a domain error to a localized RFC 9457 body (with the extensions of the contract's TicketConflictProblem). */
export function problemFromDomainError(error: DomainError, ctx: ProblemContext): ProblemDetails {
  if (error instanceof TicketAlreadyUsedError) {
    return problemFor(
      error.code,
      ctx,
      error.usedAt ? { usedAt: formatDateTime(error.usedAt, ctx.locale) } : {},
      { ticketId: error.ticketId, usedAt: error.usedAt ? error.usedAt.toISOString() : null },
    );
  }
  if (error instanceof ValidationWindowClosedError) {
    return problemFor(error.code, ctx, {
      opensAt: formatDateTime(error.opensAt, ctx.locale),
      closesAt: formatDateTime(error.closesAt, ctx.locale),
    });
  }
  return problemFor(error.code, ctx);
}
