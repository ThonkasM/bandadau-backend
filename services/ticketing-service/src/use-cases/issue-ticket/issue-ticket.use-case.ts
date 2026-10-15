import { Ticket } from '../../entities/ticket.entity';
import { ticketIssued, ticketIssueFailed } from '../messages';
import type { Clock } from '../ports/clock';
import type { EventPublisher, MessageTrace } from '../ports/event-publisher';
import type { IdGenerator } from '../ports/id-generator';
import type { TicketRepository } from '../ports/ticket.repository';
import type { TransactionContext } from '../ports/transaction';

export interface IssueTicketInput {
  sagaId: string;
  registrationId: string;
  eventId: string;
  userId: string;
  eventTitle: string;
  eventStartsAt: Date;
  eventEndsAt: Date | null;
  venue: string;
  organizerId: string | null;
  staffUserIds: string[];
}

export type IssueTicketOutcome =
  | { outcome: 'ISSUED'; ticketId: string; replayed: boolean }
  | { outcome: 'FAILED'; reason: 'CHAOS_INJECTED' | 'ALREADY_VOIDED' };

export class IssueTicketUseCase {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly publisher: EventPublisher,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly options: { chaosFail: boolean },
  ) {}

  async execute(input: IssueTicketInput, trace: MessageTrace, tx?: TransactionContext): Promise<IssueTicketOutcome> {
    const now = this.clock.now();
    const base = { sagaId: input.sagaId, registrationId: input.registrationId, now };

    if (this.options.chaosFail) {
      await this.publisher.publish(
        [ticketIssueFailed({ ...base, reason: 'CHAOS_INJECTED', detail: 'CHAOS_TICKETING_FAIL active' }, trace)],
        tx,
      );
      return { outcome: 'FAILED', reason: 'CHAOS_INJECTED' };
    }

    const record = await this.tickets.findRegistration(input.registrationId);
    if (record?.state === 'VOIDED') {
      await this.publisher.publish(
        [ticketIssueFailed({ ...base, reason: 'ALREADY_VOIDED', detail: 'The registration was voided before the ticket was issued' }, trace)],
        tx,
      );
      return { outcome: 'FAILED', reason: 'ALREADY_VOIDED' };
    }

    if (record?.ticketId) {
      const existing = await this.tickets.findById(record.ticketId);
      await this.publisher.publish(
        [
          ticketIssued(
            {
              ...base,
              ticketId: record.ticketId,
              eventId: existing?.eventId ?? input.eventId,
              userId: existing?.userId ?? input.userId,
            },
            trace,
          ),
        ],
        tx,
      );
      return { outcome: 'ISSUED', ticketId: record.ticketId, replayed: true };
    }

    const ticket = Ticket.issue({
      id: this.ids.next(),
      registrationId: input.registrationId,
      eventId: input.eventId,
      userId: input.userId,
      eventTitle: input.eventTitle,
      eventStartsAt: input.eventStartsAt,
      eventEndsAt: input.eventEndsAt,
      venue: input.venue,
      organizerId: input.organizerId,
      staffUserIds: input.staffUserIds,
      issuedAt: now,
    });
    await this.tickets.create(
      ticket,
      [ticketIssued({ ...base, ticketId: ticket.id, eventId: ticket.eventId, userId: ticket.userId }, trace)],
      tx,
    );
    return { outcome: 'ISSUED', ticketId: ticket.id, replayed: false };
  }
}
