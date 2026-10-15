import { type IssueTicketInput,IssueTicketUseCase } from '../../../src/use-cases/issue-ticket/issue-ticket.use-case';
import { VoidTicketUseCase } from '../../../src/use-cases/void-ticket/void-ticket.use-case';
import { FixedClock, IDS, InMemoryTicketRepository, RecordingPublisher, SequentialIds } from '../../support/fakes';

const now = new Date('2026-10-14T14:00:00Z');
const command: IssueTicketInput = {
  sagaId: IDS.saga,
  registrationId: IDS.registration,
  eventId: IDS.event,
  userId: IDS.user,
  eventTitle: 'Taller de Docker',
  eventStartsAt: new Date('2026-10-20T22:00:00Z'),
  eventEndsAt: null,
  venue: 'Auditorio',
  organizerId: IDS.organizer,
  staffUserIds: [],
};

function setup(chaosFail = false) {
  const repo = new InMemoryTicketRepository();
  const publisher = new RecordingPublisher();
  const clock = new FixedClock(now);
  return {
    repo,
    publisher,
    issue: new IssueTicketUseCase(repo, publisher, clock, new SequentialIds(), { chaosFail }),
    void: new VoidTicketUseCase(repo, publisher, clock),
  };
}

describe('IssueTicketUseCase', () => {
  it('issues one ticket and answers ticket-issued', async () => {
    const s = setup();
    const result = await s.issue.execute(command, {});
    expect(result).toMatchObject({ outcome: 'ISSUED', replayed: false });
    expect(s.repo.tickets.size).toBe(1);
    expect(s.repo.outbox.map((m) => m.type)).toEqual(['bandada.ticketing.ticket-issued.v1']);
  });

  it('is idempotent per registration: re-issuing answers with the same ticket', async () => {
    const s = setup();
    const first = await s.issue.execute(command, {});
    const second = await s.issue.execute(command, {});
    expect(second).toMatchObject({ outcome: 'ISSUED', replayed: true });
    expect((second as { ticketId: string }).ticketId).toBe((first as { ticketId: string }).ticketId);
    expect(s.repo.tickets.size).toBe(1);
    expect(s.publisher.types()).toEqual(['bandada.ticketing.ticket-issued.v1']);
  });

  it('answers ticket-issue-failed CHAOS_INJECTED when chaos is on and writes nothing', async () => {
    const s = setup(true);
    expect(await s.issue.execute(command, {})).toEqual({ outcome: 'FAILED', reason: 'CHAOS_INJECTED' });
    expect(s.repo.tickets.size).toBe(0);
    expect(s.publisher.published[0]?.data).toMatchObject({ reason: 'CHAOS_INJECTED', registrationId: IDS.registration });
  });

  it('rejects a late issue after a void with ALREADY_VOIDED', async () => {
    const s = setup();
    await s.void.execute({ sagaId: IDS.saga, registrationId: IDS.registration, ticketId: null }, {});
    expect(await s.issue.execute(command, {})).toEqual({ outcome: 'FAILED', reason: 'ALREADY_VOIDED' });
    expect(s.repo.tickets.size).toBe(0);
  });

  it('carries the trace of the command to the response', async () => {
    const s = setup();
    await s.issue.execute(command, { causationId: 'c1', correlationId: 'corr', sagaId: IDS.saga });
    expect(s.repo.outbox[0]?.trace).toEqual({ causationId: 'c1', correlationId: 'corr', sagaId: IDS.saga });
  });
});

describe('VoidTicketUseCase', () => {
  it('voids an issued ticket and answers ticket-voided', async () => {
    const s = setup();
    const issued = (await s.issue.execute(command, {})) as { ticketId: string };
    const result = await s.void.execute({ sagaId: IDS.saga, registrationId: IDS.registration, ticketId: issued.ticketId }, {});
    expect(result).toEqual({ outcome: 'VOIDED', ticketId: issued.ticketId });
    expect(s.repo.tickets.get(issued.ticketId)?.status).toBe('VOIDED');
  });

  it('answers ticket-voided with a null ticket when none exists and records the tombstone', async () => {
    const s = setup();
    const result = await s.void.execute({ sagaId: IDS.saga, registrationId: IDS.registration, ticketId: null }, {});
    expect(result).toEqual({ outcome: 'VOIDED', ticketId: null });
    expect(s.repo.registrations.get(IDS.registration)).toMatchObject({ state: 'VOIDED', ticketId: null });
    expect(s.repo.outbox[0]?.data).toMatchObject({ ticketId: null });
  });

  it('is idempotent when voided twice', async () => {
    const s = setup();
    await s.void.execute({ sagaId: IDS.saga, registrationId: IDS.registration, ticketId: null }, {});
    await s.void.execute({ sagaId: IDS.saga, registrationId: IDS.registration, ticketId: null }, {});
    expect(s.publisher.types()).toEqual(['bandada.ticketing.ticket-voided.v1']);
    expect(s.repo.outbox).toHaveLength(1);
  });

  it('answers ticket-void-failed TICKET_ALREADY_USED for a used ticket and leaves it untouched', async () => {
    const s = setup();
    const issued = (await s.issue.execute(command, {})) as { ticketId: string };
    const ticket = s.repo.tickets.get(issued.ticketId)!;
    const usedAt = new Date('2026-10-20T21:00:00Z');
    s.repo.tickets.set(ticket.id, ticket.markUsed(IDS.organizer, usedAt));
    const result = await s.void.execute({ sagaId: IDS.saga, registrationId: IDS.registration, ticketId: issued.ticketId }, {});
    expect(result).toEqual({ outcome: 'FAILED', reason: 'TICKET_ALREADY_USED' });
    expect(s.publisher.published[0]?.data).toMatchObject({ reason: 'TICKET_ALREADY_USED', usedAt: usedAt.toISOString() });
    expect(s.repo.tickets.get(ticket.id)?.status).toBe('USED');
  });
});
