import type { TicketValidationDto } from '../../data-sources/types';
import type { GatewayContext } from '../../graphql/context';
import type { TicketsService } from './tickets.service';

type Ctx = GatewayContext;

export function ticketsResolvers(service: TicketsService) {
  return {
    Query: {
      ticketValidations: (_: unknown, a: { range: { from: string; to: string }; eventId?: string; first?: number }, ctx: Ctx) => service.validations(ctx, a),
    },
    TicketValidation: {
      attendee: (v: TicketValidationDto, _: unknown, ctx: Ctx) => ctx.loaders.users.load(v.attendeeId),
      validatedBy: (v: TicketValidationDto, _: unknown, ctx: Ctx) => ctx.loaders.users.load(v.validatedBy),
    },
  };
}
