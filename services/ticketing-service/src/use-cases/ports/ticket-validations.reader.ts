export const TICKET_VALIDATIONS_READER = Symbol('TicketValidationsReader');

/** A ticket that was validated at the door: who held it and who scanned it. */
export interface TicketValidationRow {
  ticketId: string;
  eventId: string;
  eventTitle: string;
  attendeeId: string;
  validatedBy: string;
  validatedAt: Date;
}

export interface TicketValidationsFilter {
  /** Inclusive lower bound of `usedAt`. */
  usedFrom: Date;
  /** Exclusive upper bound of `usedAt`. */
  usedBefore: Date;
  eventId?: string;
}

export interface TicketValidationsScan {
  rows: TicketValidationRow[];
  /** `true` when `maxRows` was reached while more tickets could still match. */
  truncated: boolean;
}

export interface TicketValidationsReader {
  /** Administrative, low-frequency read (table scan bounded by `maxRows`). */
  scan(filter: TicketValidationsFilter, maxRows: number): Promise<TicketValidationsScan>;
}
