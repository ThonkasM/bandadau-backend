export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'EMPTY_POST'
  | 'VALIDATION_FAILED'
  | 'INVALID_MEDIA_COMBINATION'
  | 'MEDIA_NOT_FOUND'
  | 'MEDIA_NOT_OWNED'
  | 'MEDIA_NOT_APPROVED'
  | 'MEDIA_REJECTED'
  | 'INVALID_MEDIA_KIND'
  | 'GROUP_REQUIRED'
  | 'GROUP_NOT_FOUND'
  | 'GROUP_MEMBERSHIP_REQUIRED'
  | 'POST_NOT_PUBLISHED'
  | 'CANNOT_FOLLOW_SELF'
  | 'CANNOT_REPORT_OWN_CONTENT'
  | 'ALREADY_REPORTED'
  | 'MEMBERSHIP_NOT_PENDING'
  | 'OWNER_CANNOT_LEAVE'
  | 'INVALID_STATUS_TRANSITION'
  | 'SERVICE_UNAVAILABLE'
  | 'DUPLICATE_CLIENT_ID';

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
