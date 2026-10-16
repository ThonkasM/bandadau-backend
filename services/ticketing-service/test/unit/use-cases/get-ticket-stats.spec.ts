import { InvalidRangeError } from '../../../src/entities/errors/domain-errors';
import { TicketStatus } from '../../../src/entities/ticket-status';
import { GetTicketStatsUseCase, MAX_ANALYZED_TICKETS } from '../../../src/use-cases/get-ticket-stats/get-ticket-stats.use-case';
import type { TicketStatRow, TicketStatsFilter, TicketStatsReader } from '../../../src/use-cases/ports/ticket-stats.reader';

class FakeReader implements TicketStatsReader {
  calls: Array<{ filter: TicketStatsFilter; maxRows: number }> = [];
  constructor(private readonly rows: TicketStatRow[], private readonly truncated = false) {}
  async scan(filter: TicketStatsFilter, maxRows: number) {
    this.calls.push({ filter, maxRows });
    return { rows: this.rows, truncated: this.truncated };
  }
}

const row = (eventId: string, status: TicketStatus, eventTitle = `T-${eventId}`): TicketStatRow => ({ eventId, eventTitle, status });

describe('GetTicketStatsUseCase', () => {
  it('counts issued/used/voided per cohort and orders byEvent by used, issued, eventId', async () => {
    const reader = new FakeReader([
      row('b', TicketStatus.USED), row('b', TicketStatus.ISSUED),
      row('a', TicketStatus.USED), row('a', TicketStatus.ISSUED),
      row('c', TicketStatus.USED), row('c', TicketStatus.USED), row('c', TicketStatus.VOIDED),
      row('d', TicketStatus.VOIDED),
    ]);
    const out = await new GetTicketStatsUseCase(reader).execute({ from: '2026-10-01', to: '2026-10-16' });
    expect(out).toMatchObject({ from: '2026-10-01', to: '2026-10-16', issued: 8, used: 4, voided: 2, usageRate: 0.5, truncated: false });
    expect(out.byEvent.map((e) => e.eventId)).toEqual(['c', 'a', 'b', 'd']);
    expect(out.byEvent[0]).toEqual({ eventId: 'c', title: 'T-c', issued: 3, used: 2, voided: 1 });
    expect(reader.calls[0]?.filter.issuedFrom.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(reader.calls[0]?.filter.issuedBefore.toISOString()).toBe('2026-10-17T00:00:00.000Z');
    expect(reader.calls[0]?.maxRows).toBe(MAX_ANALYZED_TICKETS);
  });

  it('rounds usageRate to 4 decimals and is 0 with no tickets', async () => {
    const rows = [row('a', TicketStatus.USED), row('a', TicketStatus.ISSUED), row('a', TicketStatus.ISSUED)];
    expect((await new GetTicketStatsUseCase(new FakeReader(rows)).execute({ from: '2026-10-01', to: '2026-10-01' })).usageRate).toBe(0.3333);
    const empty = await new GetTicketStatsUseCase(new FakeReader([])).execute({ from: '2026-10-01', to: '2026-10-01' });
    expect(empty).toMatchObject({ issued: 0, used: 0, voided: 0, usageRate: 0, byEvent: [] });
  });

  it('caps byEvent at 50 rows, passes eventId and propagates truncated', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(`e${String(i).padStart(2, '0')}`, TicketStatus.ISSUED));
    const reader = new FakeReader(rows, true);
    const out = await new GetTicketStatsUseCase(reader).execute({ from: '2026-10-01', to: '2026-10-01', eventId: 'e01' });
    expect(out.byEvent).toHaveLength(50);
    expect(out.truncated).toBe(true);
    expect(out.issued).toBe(60);
    expect(reader.calls[0]?.filter.eventId).toBe('e01');
  });

  it('rejects reversed, invalid and over-366-day ranges with INVALID_RANGE', async () => {
    const uc = new GetTicketStatsUseCase(new FakeReader([]));
    await expect(uc.execute({ from: '2026-10-02', to: '2026-10-01' })).rejects.toBeInstanceOf(InvalidRangeError);
    await expect(uc.execute({ from: '2026-13-45', to: '2026-10-01' })).rejects.toBeInstanceOf(InvalidRangeError);
    await expect(uc.execute({ from: '2025-01-01', to: '2026-10-01' })).rejects.toMatchObject({ code: 'INVALID_RANGE' });
    await expect(uc.execute({ from: '2026-01-01', to: '2026-12-31' })).resolves.toMatchObject({ issued: 0 });
  });
});
