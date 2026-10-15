import type { TicketStatus } from '../../entities/ticket-status';
import type { TicketPage, TicketRepository } from '../ports/ticket.repository';

export class ListMyTicketsUseCase {
  constructor(private readonly tickets: TicketRepository) {}

  execute(input: { userId: string; status?: TicketStatus; cursor?: string; limit: number }): Promise<TicketPage> {
    return this.tickets.listByUser(input);
  }
}
