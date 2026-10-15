import { TicketAccessDeniedError, TicketNotFoundError } from '../../entities/errors/domain-errors';
import type { QrClaims } from '../../entities/qr-claims';
import type { Ticket } from '../../entities/ticket.entity';
import type { QrSigner } from '../ports/qr-signer';
import type { TicketRepository } from '../ports/ticket.repository';

export interface GetTicketOutput {
  ticket: Ticket;
  qrPayload: string;
}

export class GetTicketUseCase {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly signer: QrSigner,
  ) {}

  async execute(input: { ticketId: string; actor: { id: string; roles: readonly string[] } }): Promise<GetTicketOutput> {
    const ticket = await this.tickets.findById(input.ticketId);
    if (!ticket) throw new TicketNotFoundError();
    if (ticket.userId !== input.actor.id && !input.actor.roles.includes('ADMIN')) throw new TicketAccessDeniedError();

    const claims: QrClaims = {
      tid: ticket.id,
      eid: ticket.eventId,
      rid: ticket.registrationId,
      sub: ticket.userId,
      iat: Math.floor(ticket.issuedAt.getTime() / 1000),
    };
    return { ticket, qrPayload: await this.signer.sign(claims) };
  }
}
