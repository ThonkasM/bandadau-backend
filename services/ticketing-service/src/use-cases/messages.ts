import type { MessageTrace, OutboundMessage } from './ports/event-publisher';

const registrationSubject = (registrationId: string) => `registrations/${registrationId}`;

export function ticketIssued(
  input: { sagaId: string; registrationId: string; ticketId: string; eventId: string; userId: string; now: Date },
  trace: MessageTrace,
): OutboundMessage {
  return {
    type: 'bandada.ticketing.ticket-issued.v1',
    subject: registrationSubject(input.registrationId),
    data: {
      sagaId: input.sagaId,
      registrationId: input.registrationId,
      ticketId: input.ticketId,
      eventId: input.eventId,
      userId: input.userId,
      occurredAt: input.now.toISOString(),
    },
    trace,
  };
}

export type IssueFailureReason = 'STORAGE_ERROR' | 'SIGNING_ERROR' | 'CHAOS_INJECTED' | 'ALREADY_VOIDED';

export function ticketIssueFailed(
  input: { sagaId: string; registrationId: string; reason: IssueFailureReason; detail: string | null; now: Date },
  trace: MessageTrace,
): OutboundMessage {
  return {
    type: 'bandada.ticketing.ticket-issue-failed.v1',
    subject: registrationSubject(input.registrationId),
    data: {
      sagaId: input.sagaId,
      registrationId: input.registrationId,
      reason: input.reason,
      detail: input.detail,
      occurredAt: input.now.toISOString(),
    },
    trace,
  };
}

export function ticketVoided(
  input: { sagaId: string; registrationId: string; ticketId: string | null; now: Date },
  trace: MessageTrace,
): OutboundMessage {
  return {
    type: 'bandada.ticketing.ticket-voided.v1',
    subject: registrationSubject(input.registrationId),
    data: {
      sagaId: input.sagaId,
      registrationId: input.registrationId,
      ticketId: input.ticketId,
      occurredAt: input.now.toISOString(),
    },
    trace,
  };
}

export function ticketVoidFailed(
  input: { sagaId: string; registrationId: string; ticketId: string; usedAt: Date | null; now: Date },
  trace: MessageTrace,
): OutboundMessage {
  return {
    type: 'bandada.ticketing.ticket-void-failed.v1',
    subject: registrationSubject(input.registrationId),
    data: {
      sagaId: input.sagaId,
      registrationId: input.registrationId,
      ticketId: input.ticketId,
      reason: 'TICKET_ALREADY_USED',
      usedAt: input.usedAt ? input.usedAt.toISOString() : null,
      occurredAt: input.now.toISOString(),
    },
    trace,
  };
}

export function ticketUsed(
  input: { ticketId: string; registrationId: string; eventId: string; userId: string; validatedBy: string; now: Date },
  trace: MessageTrace,
): OutboundMessage {
  return {
    type: 'bandada.ticketing.ticket.used.v1',
    subject: `tickets/${input.ticketId}`,
    data: {
      ticketId: input.ticketId,
      registrationId: input.registrationId,
      eventId: input.eventId,
      userId: input.userId,
      validatedBy: input.validatedBy,
      occurredAt: input.now.toISOString(),
    },
    trace,
  };
}
