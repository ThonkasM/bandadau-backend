import type { TicketStatus } from '../../entities/ticket-status';

export const TICKET_STATS_READER = Symbol('TicketStatsReader');

/** Minimal projection of a ticket for statistics: no user, QR or personal data. */
export interface TicketStatRow {
  eventId: string;
  eventTitle: string;
  status: TicketStatus;
}

export interface TicketStatsFilter {
  /** Inclusive lower bound of `issuedAt`. */
  issuedFrom: Date;
  /** Exclusive upper bound of `issuedAt`. */
  issuedBefore: Date;
  eventId?: string;
}

export interface TicketStatsScan {
  rows: TicketStatRow[];
  /** `true` when `maxRows` was reached while more tickets could still match. */
  truncated: boolean;
}

export interface TicketStatsReader {
  /** Administrative, low-frequency read (table scan bounded by `maxRows`). */
  scan(filter: TicketStatsFilter, maxRows: number): Promise<TicketStatsScan>;
}
