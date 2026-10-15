export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class TicketNotFoundError extends DomainError {
  readonly code = 'TICKET_NOT_FOUND';
}

export class TicketAlreadyUsedError extends DomainError {
  readonly code = 'TICKET_ALREADY_USED';

  constructor(
    readonly ticketId: string,
    readonly usedAt: Date | null,
  ) {
    super();
  }
}

export class TicketVoidedError extends DomainError {
  readonly code = 'TICKET_VOIDED';

  constructor(readonly ticketId: string) {
    super();
  }
}

export class InvalidQrSignatureError extends DomainError {
  readonly code = 'INVALID_QR_SIGNATURE';
}

export class TicketEventMismatchError extends DomainError {
  readonly code = 'TICKET_EVENT_MISMATCH';
}

export class ValidationWindowClosedError extends DomainError {
  readonly code = 'VALIDATION_WINDOW_CLOSED';

  constructor(
    readonly opensAt: Date,
    readonly closesAt: Date,
  ) {
    super();
  }
}

export class NotEventOrganizerError extends DomainError {
  readonly code = 'NOT_EVENT_ORGANIZER';
}

export class TicketAccessDeniedError extends DomainError {
  readonly code = 'FORBIDDEN';
}

export class InvalidCursorError extends DomainError {
  readonly code = 'INVALID_CURSOR';
}

/** Another writer changed the ticket or the registration record first; the caller re-reads and decides again. */
export class ConcurrentTransitionError extends DomainError {
  readonly code = 'CONCURRENT_MODIFICATION';
}
