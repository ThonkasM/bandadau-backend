import { TicketAlreadyUsedError } from '../../entities/errors/domain-errors';
import { TicketStatus } from '../../entities/ticket-status';
import { ticketVoided, ticketVoidFailed } from '../messages';
import type { Clock } from '../ports/clock';
import type { EventPublisher, MessageTrace } from '../ports/event-publisher';
import type { TicketRepository } from '../ports/ticket.repository';
import type { TransactionContext } from '../ports/transaction';

export interface VoidTicketInput {
  sagaId: string;
  registrationId: string;
  ticketId: string | null;
}

export type VoidTicketOutcome =
  | { outcome: 'VOIDED'; ticketId: string | null }
  | { outcome: 'FAILED'; reason: 'TICKET_ALREADY_USED' };

export class VoidTicketUseCase {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly publisher: EventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(input: VoidTicketInput, trace: MessageTrace, tx?: TransactionContext): Promise<VoidTicketOutcome> {
    const now = this.clock.now();
    const base = { sagaId: input.sagaId, registrationId: input.registrationId, now };

    const record = await this.tickets.findRegistration(input.registrationId);
    const ticketId = record?.ticketId ?? input.ticketId;
    const ticket = ticketId ? await this.tickets.findById(ticketId) : null;

    if (!ticket) {
      // Nothing issued yet: remember the void so a late issue-ticket is rejected (ALREADY_VOIDED).
      if (record?.state === 'VOIDED') {
        await this.publisher.publish([ticketVoided({ ...base, ticketId: null }, trace)], tx);
      } else {
        await this.tickets.recordVoidTombstone(input.registrationId, [ticketVoided({ ...base, ticketId: null }, trace)], tx);
      }
      return { outcome: 'VOIDED', ticketId: null };
    }

    if (ticket.status === TicketStatus.USED) {
      await this.publisher.publish([ticketVoidFailed({ ...base, ticketId: ticket.id, usedAt: ticket.usedAt }, trace)], tx);
      return { outcome: 'FAILED', reason: 'TICKET_ALREADY_USED' };
    }

    if (ticket.status === TicketStatus.VOIDED) {
      await this.publisher.publish([ticketVoided({ ...base, ticketId: ticket.id }, trace)], tx);
      return { outcome: 'VOIDED', ticketId: ticket.id };
    }

    try {
      const voided = ticket.void(now);
      await this.tickets.markVoided(voided, [ticketVoided({ ...base, ticketId: ticket.id }, trace)], tx);
    } catch (error) {
      if (error instanceof TicketAlreadyUsedError) {
        await this.publisher.publish([ticketVoidFailed({ ...base, ticketId: ticket.id, usedAt: error.usedAt }, trace)], tx);
        return { outcome: 'FAILED', reason: 'TICKET_ALREADY_USED' };
      }
      throw error;
    }
    return { outcome: 'VOIDED', ticketId: ticket.id };
  }
}
