import { InvalidRangeError } from '../../entities/errors/domain-errors';
import { TicketStatus } from '../../entities/ticket-status';
import type { TicketStatsReader } from '../ports/ticket-stats.reader';

export interface TicketStatsByEvent {
  eventId: string;
  title: string;
  issued: number;
  used: number;
  voided: number;
}

export interface TicketStatsOutput {
  from: string;
  to: string;
  issued: number;
  used: number;
  voided: number;
  usageRate: number;
  truncated: boolean;
  byEvent: TicketStatsByEvent[];
}

export interface GetTicketStatsInput {
  from: string;
  to: string;
  eventId?: string;
}

const DAY_MS = 86_400_000;
export const MAX_RANGE_DAYS = 366;
export const MAX_ANALYZED_TICKETS = 20_000;
export const MAX_EVENT_ROWS = 50;

const rate = (used: number, issued: number): number => (issued === 0 ? 0 : Math.round((used / issued) * 10_000) / 10_000);

/** Cohort statistics of tickets issued in a UTC date range (feeds MCP `get_ticket_stats`). Aggregates only. */
export class GetTicketStatsUseCase {
  constructor(private readonly reader: TicketStatsReader) {}

  async execute(input: GetTicketStatsInput): Promise<TicketStatsOutput> {
    const from = new Date(`${input.from}T00:00:00.000Z`);
    const to = new Date(`${input.to}T00:00:00.000Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) throw new InvalidRangeError();
    if (Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1 > MAX_RANGE_DAYS) throw new InvalidRangeError();

    const { rows, truncated } = await this.reader.scan(
      { issuedFrom: from, issuedBefore: new Date(to.getTime() + DAY_MS), ...(input.eventId ? { eventId: input.eventId } : {}) },
      MAX_ANALYZED_TICKETS,
    );

    const events = new Map<string, TicketStatsByEvent>();
    let used = 0;
    let voided = 0;
    for (const row of rows) {
      const e = events.get(row.eventId) ?? { eventId: row.eventId, title: row.eventTitle, issued: 0, used: 0, voided: 0 };
      e.issued += 1;
      if (row.status === TicketStatus.USED) {
        e.used += 1;
        used += 1;
      } else if (row.status === TicketStatus.VOIDED) {
        e.voided += 1;
        voided += 1;
      }
      events.set(row.eventId, e);
    }
    const byEvent = [...events.values()]
      .sort((a, b) => b.used - a.used || b.issued - a.issued || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0))
      .slice(0, MAX_EVENT_ROWS);
    return { from: input.from, to: input.to, issued: rows.length, used, voided, usageRate: rate(used, rows.length), truncated, byEvent };
  }
}
