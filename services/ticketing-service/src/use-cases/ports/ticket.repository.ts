import type { Ticket } from '../../entities/ticket.entity';
import type { TicketStatus } from '../../entities/ticket-status';
import type { OutboundMessage } from './event-publisher';
import type { TransactionContext } from './transaction';

/** One-ticket-per-registration record. `VOIDED` with `ticketId = null` is the tombstone of a void that arrived first. */
export interface RegistrationRecord {
  registrationId: string;
  state: 'ISSUED' | 'VOIDED';
  ticketId: string | null;
}

export interface ListTicketsQuery {
  userId: string;
  status?: TicketStatus;
  cursor?: string;
  limit: number;
}

export interface TicketPage {
  items: Ticket[];
  nextCursor: string | null;
}

export interface TicketRepository {
  findById(ticketId: string): Promise<Ticket | null>;
  findRegistration(registrationId: string): Promise<RegistrationRecord | null>;
  listByUser(query: ListTicketsQuery): Promise<TicketPage>;

  /** Stages (or commits, without `tx`) the registration record + ticket + messages. Conflicts raise `ConcurrentTransitionError`. */
  create(ticket: Ticket, messages: OutboundMessage[], tx?: TransactionContext): Promise<void>;
  /** ISSUED -> USED, conditional on the stored status. Raises `ConcurrentTransitionError` when the condition fails. */
  markUsed(ticket: Ticket, messages: OutboundMessage[], tx?: TransactionContext): Promise<void>;
  /** ISSUED -> VOIDED (and the registration record). Raises `ConcurrentTransitionError` when the condition fails. */
  markVoided(ticket: Ticket, messages: OutboundMessage[], tx?: TransactionContext): Promise<void>;
  /** Records that the registration was voided before any ticket existed. */
  recordVoidTombstone(registrationId: string, messages: OutboundMessage[], tx?: TransactionContext): Promise<void>;
}
export const TICKET_REPOSITORY = Symbol('TicketRepository');
