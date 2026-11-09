import { clampFirst } from '../../common/relay';
import type { DataSources } from '../../data-sources/data-sources';
import type { TicketValidationList } from '../../data-sources/types';
import type { GatewayContext } from '../../graphql/context';

export class TicketsService {
  constructor(private readonly ds: DataSources) {}

  /** Attendance report: validated tickets in the range (names are resolved by the `TicketValidation` field resolvers). */
  validations(ctx: GatewayContext, args: { range: { from: string; to: string }; eventId?: string | null; first?: number | null }): Promise<TicketValidationList> {
    return this.ds.ticketing.listValidations(ctx.call, {
      from: args.range.from,
      to: args.range.to,
      ...(args.eventId ? { eventId: args.eventId } : {}),
      limit: clampFirst(args.first, 500, 100),
    });
  }
}
