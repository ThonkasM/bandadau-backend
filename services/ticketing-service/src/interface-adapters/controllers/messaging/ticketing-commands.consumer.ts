import type { MessageContext } from '@bandada/messaging-ts';
import { type CloudEvent, type DynamoTransaction, PermanentError } from '@bandada/messaging-ts';
import { ConsumeMessage } from '@bandada/messaging-ts/nest';
import { Inject, Injectable } from '@nestjs/common';

import { IssueTicketUseCase } from '../../../use-cases/issue-ticket/issue-ticket.use-case';
import type { MessageTrace } from '../../../use-cases/ports/event-publisher';
import { VoidTicketUseCase } from '../../../use-cases/void-ticket/void-ticket.use-case';

/** Queue owned by this service (created by bandadau-infra). Override only in tests. */
export const COMMANDS_QUEUE = process.env.TICKETING_COMMANDS_QUEUE ?? 'ticketing-service.commands';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface IssueTicketData {
  sagaId: string;
  registrationId: string;
  eventId: string;
  userId: string;
  eventTitle: string;
  eventStartsAt: string;
  venue: string;
  /** Not in the contract yet (UC-14 PROPUESTA 3); optional. */
  organizerId?: string | null;
  staffUserIds?: string[];
  eventEndsAt?: string | null;
}

interface VoidTicketData {
  sagaId: string;
  registrationId: string;
  ticketId: string | null;
}

function traceOf(event: CloudEvent): MessageTrace {
  return { causationId: event.id, correlationId: event.correlationid, sagaId: event.sagaid, traceparent: event.traceparent };
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new PermanentError(`Invalid ${field}`);
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new PermanentError(`Invalid ${field}`);
  return value;
}

function parseDate(value: unknown, field: string): Date {
  const date = new Date(requireString(value, field));
  if (Number.isNaN(date.getTime())) throw new PermanentError(`Invalid ${field}`);
  return date;
}

@Injectable()
export class TicketingCommandsConsumer {
  constructor(
    @Inject(IssueTicketUseCase) private readonly issueTicket: IssueTicketUseCase,
    @Inject(VoidTicketUseCase) private readonly voidTicket: VoidTicketUseCase,
  ) {}

  @ConsumeMessage({ queue: COMMANDS_QUEUE, type: 'bandada.ticketing.cmd.issue-ticket.v1' })
  async onIssueTicket(event: CloudEvent<IssueTicketData>, ctx: MessageContext<DynamoTransaction>): Promise<void> {
    const d = event.data ?? ({} as IssueTicketData);
    const staff = Array.isArray(d.staffUserIds) ? d.staffUserIds.filter((id) => typeof id === 'string') : [];
    await this.issueTicket.execute(
      {
        sagaId: requireUuid(d.sagaId, 'sagaId'),
        registrationId: requireUuid(d.registrationId, 'registrationId'),
        eventId: requireUuid(d.eventId, 'eventId'),
        userId: requireUuid(d.userId, 'userId'),
        eventTitle: requireString(d.eventTitle, 'eventTitle'),
        eventStartsAt: parseDate(d.eventStartsAt, 'eventStartsAt'),
        eventEndsAt: d.eventEndsAt ? parseDate(d.eventEndsAt, 'eventEndsAt') : null,
        venue: requireString(d.venue, 'venue'),
        organizerId: typeof d.organizerId === 'string' ? d.organizerId : null,
        staffUserIds: staff,
      },
      traceOf(event),
      ctx.tx,
    );
  }

  @ConsumeMessage({ queue: COMMANDS_QUEUE, type: 'bandada.ticketing.cmd.void-ticket.v1' })
  async onVoidTicket(event: CloudEvent<VoidTicketData>, ctx: MessageContext<DynamoTransaction>): Promise<void> {
    const d = event.data ?? ({} as VoidTicketData);
    await this.voidTicket.execute(
      {
        sagaId: requireUuid(d.sagaId, 'sagaId'),
        registrationId: requireUuid(d.registrationId, 'registrationId'),
        ticketId: d.ticketId === null || d.ticketId === undefined ? null : requireUuid(d.ticketId, 'ticketId'),
      },
      traceOf(event),
      ctx.tx,
    );
  }
}
