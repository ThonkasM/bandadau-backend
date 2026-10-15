export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'MEDIA_TOO_LARGE'
  | 'VIDEO_TOO_LONG'
  | 'UPLOAD_MISSING'
  | 'UPLOAD_MISMATCH'
  | 'UPLOAD_EXPIRED'
  | 'MEDIA_NOT_FLAGGED'
  | 'SERVICE_UNAVAILABLE';

/** Business rule violation. `code` is stable; the HTTP mapping and the localized text live in interface-adapters. */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    readonly meta: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'DomainError';
  }
}
