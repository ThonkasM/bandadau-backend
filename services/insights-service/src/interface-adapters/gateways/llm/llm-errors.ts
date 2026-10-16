import { LlmUnavailableError } from '../../../entities/errors/domain-errors';

/** Typed provider failures. All are `LlmUnavailableError`, so the engine chain (and `LLM_FALLBACK`) treats them as "try the next engine". */
export class LlmAuthError extends LlmUnavailableError {
  constructor(readonly status: 401 | 403 | 0, message = 'The provider rejected the credentials') {
    super(`auth ${status || 'missing'}: ${message}`);
  }
}
export class LlmNotFoundError extends LlmUnavailableError {
  constructor(message = 'Endpoint or model not found') {
    super(`not found 404: ${message}`);
  }
}
export class LlmRateLimitedError extends LlmUnavailableError {
  constructor(readonly retryAfterSeconds: number | null, message = 'Usage limit reached') {
    super(`rate limited 429${retryAfterSeconds !== null ? ` (retry after ${retryAfterSeconds}s)` : ''}: ${message}`);
  }
}
export class LlmServerError extends LlmUnavailableError {
  constructor(readonly status: number, message = 'Provider error') {
    super(`server ${status}: ${message}`);
  }
}
export class LlmNetworkError extends LlmUnavailableError {
  constructor(message = 'Network error or timeout') {
    super(`network: ${message}`);
  }
}
/** The provider answered, but not with something usable (bad JSON, unknown tool, arguments that break the tool schema). */
export class LlmInvalidOutputError extends LlmUnavailableError {
  constructor(message = 'Invalid model output') {
    super(`invalid output: ${message}`);
  }
}

/** `Retry-After` in seconds (delta or HTTP date); null when absent or unparsable. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const n = Number(header);
  if (Number.isFinite(n)) return Math.max(0, Math.round(n));
  const t = Date.parse(header);
  return Number.isFinite(t) ? Math.max(0, Math.round((t - now) / 1000)) : null;
}
/** 400/422: the request itself was refused (e.g. `response_format` not supported by that model). */
export class LlmBadRequestError extends LlmUnavailableError {
  constructor(readonly status: number, message = 'Bad request') {
    super(`bad request ${status}: ${message}`);
  }
}
