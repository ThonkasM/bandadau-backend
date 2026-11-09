import { InvalidRangeError } from '../../entities/errors/domain-errors';
import type { TicketValidationsReader } from '../ports/ticket-validations.reader';

export interface TicketValidationOutput {
  ticketId: string;
  eventId: string;
  eventTitle: string;
  attendeeId: string;
  validatedBy: string;
  validatedAt: string;
}

export interface ListTicketValidationsOutput {
  from: string;
  to: string;
  truncated: boolean;
  items: TicketValidationOutput[];
}

export interface ListTicketValidationsInput {
  from: string;
  to: string;
  eventId?: string;
  limit?: number;
}

const DAY_MS = 86_400_000;
export const MAX_RANGE_DAYS = 366;
export const MAX_ANALYZED_TICKETS = 20_000;
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;

/** Validated tickets in a UTC date range, newest first: who scanned each one and whose it was (attendance report). */
export class ListTicketValidationsUseCase {
  constructor(private readonly reader: TicketValidationsReader) {}

  async execute(input: ListTicketValidationsInput): Promise<ListTicketValidationsOutput> {
    const from = new Date(`${input.from}T00:00:00.000Z`);
    const to = new Date(`${input.to}T00:00:00.000Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) throw new InvalidRangeError();
    if (Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1 > MAX_RANGE_DAYS) throw new InvalidRangeError();
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);

    const { rows, truncated } = await this.reader.scan(
      { usedFrom: from, usedBefore: new Date(to.getTime() + DAY_MS), ...(input.eventId ? { eventId: input.eventId } : {}) },
      MAX_ANALYZED_TICKETS,
    );
    const items = rows
      .slice()
      .sort((a, b) => b.validatedAt.getTime() - a.validatedAt.getTime() || (a.ticketId < b.ticketId ? -1 : 1))
      .slice(0, limit)
      .map((r) => ({
        ticketId: r.ticketId,
        eventId: r.eventId,
        eventTitle: r.eventTitle,
        attendeeId: r.attendeeId,
        validatedBy: r.validatedBy,
        validatedAt: r.validatedAt.toISOString(),
      }));
    return { from: input.from, to: input.to, truncated: truncated || rows.length > limit, items };
  }
}
