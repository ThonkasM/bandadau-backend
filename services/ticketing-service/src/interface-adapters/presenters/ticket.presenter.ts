import type { Ticket } from '../../entities/ticket.entity';

export interface TicketDto {
  id: string;
  registrationId: string;
  eventId: string;
  userId: string;
  eventTitle: string;
  eventStartsAt: string;
  venue: string;
  status: string;
  issuedAt: string;
  usedAt: string | null;
  voidedAt: string | null;
}

export const toTicketDto = (t: Ticket): TicketDto => ({
  id: t.id,
  registrationId: t.registrationId,
  eventId: t.eventId,
  userId: t.userId,
  eventTitle: t.eventTitle,
  eventStartsAt: t.eventStartsAt.toISOString(),
  venue: t.venue,
  status: t.status,
  issuedAt: t.issuedAt.toISOString(),
  usedAt: t.usedAt ? t.usedAt.toISOString() : null,
  voidedAt: t.voidedAt ? t.voidedAt.toISOString() : null,
});

export const toTicketDetailDto = (t: Ticket, qrPayload: string) => ({ ...toTicketDto(t), qrPayload });
