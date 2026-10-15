import { generateKeyPairSync } from 'node:crypto';

import { ConcurrentTransitionError } from '../../src/entities/errors/domain-errors';
import { Ticket } from '../../src/entities/ticket.entity';
import { TicketStatus } from '../../src/entities/ticket-status';
import type { Clock } from '../../src/use-cases/ports/clock';
import type { EventPublisher, OutboundMessage } from '../../src/use-cases/ports/event-publisher';
import type { IdGenerator } from '../../src/use-cases/ports/id-generator';
import type { ListTicketsQuery, RegistrationRecord, TicketPage, TicketRepository } from '../../src/use-cases/ports/ticket.repository';

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  set(date: Date): void {
    this.current = date;
  }
}

export class SequentialIds implements IdGenerator {
  private n = 0;
  next(): string {
    this.n += 1;
    return `00000000-0000-7000-8000-${String(this.n).padStart(12, '0')}`;
  }
}

export class RecordingPublisher implements EventPublisher {
  readonly published: OutboundMessage[] = [];
  async publish(messages: OutboundMessage[]): Promise<void> {
    this.published.push(...messages);
  }
  types(): string[] {
    return this.published.map((m) => m.type);
  }
}

export class InMemoryTicketRepository implements TicketRepository {
  readonly tickets = new Map<string, Ticket>();
  readonly registrations = new Map<string, RegistrationRecord>();
  /** Messages staged by the write methods (a stand-in for the outbox). */
  readonly outbox: OutboundMessage[] = [];
  failNextMarkUsed = 0;

  async findById(id: string): Promise<Ticket | null> {
    return this.tickets.get(id) ?? null;
  }
  async findRegistration(registrationId: string): Promise<RegistrationRecord | null> {
    return this.registrations.get(registrationId) ?? null;
  }
  async listByUser(query: ListTicketsQuery): Promise<TicketPage> {
    const items = [...this.tickets.values()]
      .filter((t) => t.userId === query.userId && (!query.status || t.status === query.status))
      .sort((a, b) => a.eventStartsAt.getTime() - b.eventStartsAt.getTime())
      .slice(0, query.limit);
    return { items, nextCursor: null };
  }
  async create(ticket: Ticket, messages: OutboundMessage[]): Promise<void> {
    if (this.registrations.has(ticket.registrationId)) throw new ConcurrentTransitionError();
    this.registrations.set(ticket.registrationId, { registrationId: ticket.registrationId, state: 'ISSUED', ticketId: ticket.id });
    this.tickets.set(ticket.id, ticket);
    this.outbox.push(...messages);
  }
  async markUsed(ticket: Ticket, messages: OutboundMessage[]): Promise<void> {
    if (this.failNextMarkUsed > 0) {
      this.failNextMarkUsed -= 1;
      throw new ConcurrentTransitionError();
    }
    const stored = this.tickets.get(ticket.id);
    if (!stored || stored.status !== TicketStatus.ISSUED) throw new ConcurrentTransitionError();
    this.tickets.set(ticket.id, ticket);
    this.outbox.push(...messages);
  }
  async markVoided(ticket: Ticket, messages: OutboundMessage[]): Promise<void> {
    const stored = this.tickets.get(ticket.id);
    if (!stored || stored.status !== TicketStatus.ISSUED) throw new ConcurrentTransitionError();
    this.tickets.set(ticket.id, ticket);
    this.registrations.set(ticket.registrationId, { registrationId: ticket.registrationId, state: 'VOIDED', ticketId: ticket.id });
    this.outbox.push(...messages);
  }
  async recordVoidTombstone(registrationId: string, messages: OutboundMessage[]): Promise<void> {
    if (this.registrations.has(registrationId)) throw new ConcurrentTransitionError();
    this.registrations.set(registrationId, { registrationId, state: 'VOIDED', ticketId: null });
    this.outbox.push(...messages);
  }
}

export function generateEs256Pem(): string {
  return generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
}

export const IDS = {
  saga: '0192a3bf-bbbb-7ccc-8ddd-000000000888',
  registration: '0192a3bf-aaaa-7bbb-8ccc-000000000777',
  event: '0192a3be-1234-7abc-8def-000000000042',
  user: '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b',
  organizer: '0192a3b4-9999-7e8f-9a0b-1c2d3e4f0002',
  other: '0192a3b4-9999-7e8f-9a0b-1c2d3e4f0003',
};

export function sampleTicket(overrides: Partial<Parameters<typeof Ticket.issue>[0]> = {}): Ticket {
  return Ticket.issue({
    id: '0192a3c5-7777-7aaa-8bbb-000000000101',
    registrationId: IDS.registration,
    eventId: IDS.event,
    userId: IDS.user,
    eventTitle: 'Taller de Docker',
    eventStartsAt: new Date('2026-10-20T22:00:00Z'),
    eventEndsAt: null,
    venue: 'Auditorio UMSA',
    organizerId: IDS.organizer,
    staffUserIds: [],
    issuedAt: new Date('2026-10-14T14:00:03Z'),
    ...overrides,
  });
}
