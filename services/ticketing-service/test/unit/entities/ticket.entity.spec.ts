import { TicketAlreadyUsedError, TicketVoidedError } from '../../../src/entities/errors/domain-errors';
import { TicketStatus } from '../../../src/entities/ticket-status';
import { isWindowOpen, validationWindowOf } from '../../../src/entities/validation-window.policy';
import { IDS, sampleTicket } from '../../support/fakes';

describe('Ticket', () => {
  it('starts ISSUED and becomes USED once', () => {
    const used = sampleTicket().markUsed(IDS.organizer, new Date('2026-10-20T21:48:10Z'));
    expect(used.status).toBe(TicketStatus.USED);
    expect(used.usedBy).toBe(IDS.organizer);
    expect(() => used.markUsed(IDS.organizer, new Date())).toThrow(TicketAlreadyUsedError);
  });

  it('keeps final states final (invariant 5)', () => {
    const voided = sampleTicket().void(new Date());
    expect(voided.status).toBe(TicketStatus.VOIDED);
    expect(() => voided.markUsed(IDS.organizer, new Date())).toThrow(TicketVoidedError);
    expect(() => sampleTicket().markUsed(IDS.organizer, new Date()).void(new Date())).toThrow(TicketAlreadyUsedError);
    expect(voided.void(new Date())).toBe(voided);
  });

  it('reports organizer management', () => {
    const t = sampleTicket({ staffUserIds: [IDS.other] });
    expect(t.isManagedBy(IDS.organizer)).toBe(true);
    expect(t.isManagedBy(IDS.other)).toBe(true);
    expect(t.isManagedBy(IDS.user)).toBe(false);
    expect(sampleTicket({ organizerId: null }).hasOrganizerData()).toBe(false);
  });
});

describe('validation window', () => {
  const config = { opensBeforeStartMs: 2 * 3600_000, defaultDurationMs: 12 * 3600_000 };
  const window = validationWindowOf(sampleTicket(), config);

  it('opens 2h before the start and closes at the default duration', () => {
    expect(window.opensAt.toISOString()).toBe('2026-10-20T20:00:00.000Z');
    expect(window.closesAt.toISOString()).toBe('2026-10-21T10:00:00.000Z');
    expect(isWindowOpen(window, new Date('2026-10-20T19:59:59Z'))).toBe(false);
    expect(isWindowOpen(window, new Date('2026-10-20T20:00:00Z'))).toBe(true);
    expect(isWindowOpen(window, new Date('2026-10-21T10:00:01Z'))).toBe(false);
  });

  it('uses the event end when known', () => {
    const w = validationWindowOf(sampleTicket({ eventEndsAt: new Date('2026-10-20T23:30:00Z') }), config);
    expect(w.closesAt.toISOString()).toBe('2026-10-20T23:30:00.000Z');
  });
});
