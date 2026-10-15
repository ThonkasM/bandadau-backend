import {
  ConcurrentTransitionError,
  NotEventOrganizerError,
  TicketEventMismatchError,
  TicketNotFoundError,
  ValidationWindowClosedError,
} from '../../entities/errors/domain-errors';
import type { Ticket } from '../../entities/ticket.entity';
import { isWindowOpen, type ValidationWindowConfig,validationWindowOf } from '../../entities/validation-window.policy';
import { ticketUsed } from '../messages';
import type { Clock } from '../ports/clock';
import type { EventPublisher, MessageTrace } from '../ports/event-publisher';
import type { QrSigner } from '../ports/qr-signer';
import type { TicketRepository } from '../ports/ticket.repository';

const MAX_ATTEMPTS = 3;

export interface ValidateTicketInput {
  qrPayload: string;
  eventId?: string;
  actor: { id: string; roles: readonly string[] };
  trace: MessageTrace;
}

export interface ValidateTicketOptions {
  window: ValidationWindowConfig;
  /** When the ticket carries no organizer data: false = any ORGANIZER may validate, true = only ADMIN. */
  strictOrganizerCheck: boolean;
}

export class ValidateTicketUseCase {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly signer: QrSigner,
    private readonly publisher: EventPublisher,
    private readonly clock: Clock,
    private readonly options: ValidateTicketOptions,
  ) {}

  async execute(input: ValidateTicketInput): Promise<Ticket> {
    const claims = await this.signer.verify(input.qrPayload);
    if (input.eventId && input.eventId !== claims.eid) throw new TicketEventMismatchError();

    const ticket = await this.tickets.findById(claims.tid);
    if (!ticket) throw new TicketNotFoundError();
    if (ticket.eventId !== claims.eid) throw new TicketEventMismatchError();

    this.authorize(ticket, input.actor);
    ticket.assertCanBeUsed();

    const now = this.clock.now();
    const window = validationWindowOf(ticket, this.options.window);
    if (!isWindowOpen(window, now)) throw new ValidationWindowClosedError(window.opensAt, window.closesAt);

    const messages = [
      ticketUsed(
        {
          ticketId: ticket.id,
          registrationId: ticket.registrationId,
          eventId: ticket.eventId,
          userId: ticket.userId,
          validatedBy: input.actor.id,
          now,
        },
        input.trace,
      ),
    ];
    let current = ticket;
    for (let attempt = 1; ; attempt++) {
      const used = current.markUsed(input.actor.id, now);
      try {
        await this.tickets.markUsed(used, messages);
        return used;
      } catch (error) {
        if (!(error instanceof ConcurrentTransitionError) || attempt >= MAX_ATTEMPTS) throw error;
        // Lost a race or hit a transient transaction conflict: re-read and decide again on the real state.
        const fresh = await this.tickets.findById(ticket.id);
        if (!fresh) throw new TicketNotFoundError();
        fresh.assertCanBeUsed();
        current = fresh;
      }
    }
  }

  private authorize(ticket: Ticket, actor: { id: string; roles: readonly string[] }): void {
    if (actor.roles.includes('ADMIN')) return;
    if (!actor.roles.includes('ORGANIZER')) throw new NotEventOrganizerError();
    if (ticket.hasOrganizerData()) {
      if (!ticket.isManagedBy(actor.id)) throw new NotEventOrganizerError();
    } else if (this.options.strictOrganizerCheck) {
      throw new NotEventOrganizerError();
    }
  }
}
