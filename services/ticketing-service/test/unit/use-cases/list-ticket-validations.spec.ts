import { InvalidRangeError } from '../../../src/entities/errors/domain-errors';
import { ListTicketValidationsUseCase, MAX_ANALYZED_TICKETS, MAX_LIMIT } from '../../../src/use-cases/list-ticket-validations/list-ticket-validations.use-case';
import type { TicketValidationRow, TicketValidationsFilter, TicketValidationsReader } from '../../../src/use-cases/ports/ticket-validations.reader';

class FakeReader implements TicketValidationsReader {
  calls: Array<{ filter: TicketValidationsFilter; maxRows: number }> = [];
  constructor(private readonly rows: TicketValidationRow[], private readonly truncated = false) {}
  async scan(filter: TicketValidationsFilter, maxRows: number) {
    this.calls.push({ filter, maxRows });
    return { rows: this.rows, truncated: this.truncated };
  }
}

const row = (ticketId: string, at: string, validatedBy = 'julio', attendeeId = 'jorge'): TicketValidationRow => ({
  ticketId,
  eventId: 'ev-1',
  eventTitle: 'Hackathon',
  attendeeId,
  validatedBy,
  validatedAt: new Date(at),
});

describe('ListTicketValidationsUseCase', () => {
  it('returns validations newest first with who scanned and whose ticket it was', async () => {
    const reader = new FakeReader([row('t1', '2026-11-08T10:00:00Z'), row('t2', '2026-11-08T12:00:00Z', 'ana', 'luis')]);
    const out = await new ListTicketValidationsUseCase(reader).execute({ from: '2026-11-01', to: '2026-11-09' });
    expect(out.items.map((i) => i.ticketId)).toEqual(['t2', 't1']);
    expect(out.items[0]).toEqual({ ticketId: 't2', eventId: 'ev-1', eventTitle: 'Hackathon', attendeeId: 'luis', validatedBy: 'ana', validatedAt: '2026-11-08T12:00:00.000Z' });
    expect(out.truncated).toBe(false);
    expect(reader.calls[0]?.filter.usedFrom.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(reader.calls[0]?.filter.usedBefore.toISOString()).toBe('2026-11-10T00:00:00.000Z');
    expect(reader.calls[0]?.maxRows).toBe(MAX_ANALYZED_TICKETS);
  });

  it('applies the limit (default 100, max 500) and reports truncation', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`t${i}`, `2026-11-08T0${i}:00:00Z`));
    const out = await new ListTicketValidationsUseCase(new FakeReader(rows)).execute({ from: '2026-11-01', to: '2026-11-09', limit: 2 });
    expect(out.items).toHaveLength(2);
    expect(out.truncated).toBe(true);
    const big = await new ListTicketValidationsUseCase(new FakeReader(rows)).execute({ from: '2026-11-01', to: '2026-11-09', limit: 99_999 });
    expect(big.items.length).toBeLessThanOrEqual(MAX_LIMIT);
  });

  it('passes the event filter and propagates reader truncation', async () => {
    const reader = new FakeReader([], true);
    const out = await new ListTicketValidationsUseCase(reader).execute({ from: '2026-11-01', to: '2026-11-01', eventId: 'ev-9' });
    expect(reader.calls[0]?.filter.eventId).toBe('ev-9');
    expect(out).toMatchObject({ truncated: true, items: [] });
  });

  it('rejects an inverted or oversized range', async () => {
    const uc = new ListTicketValidationsUseCase(new FakeReader([]));
    await expect(uc.execute({ from: '2026-11-09', to: '2026-11-01' })).rejects.toBeInstanceOf(InvalidRangeError);
    await expect(uc.execute({ from: '2025-01-01', to: '2026-11-01' })).rejects.toBeInstanceOf(InvalidRangeError);
  });
});
