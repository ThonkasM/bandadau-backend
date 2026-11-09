import type { ServiceHttp } from '../common/http-client';
import type { CallContext, TicketValidationList } from './types';

export class TicketingClient {
  constructor(private readonly http: ServiceHttp) {}

  /** `GET /internal/v1/validations`: validated tickets in a date range (who scanned whose ticket). */
  listValidations(ctx: CallContext, q: { from: string; to: string; eventId?: string; limit?: number }) {
    return this.http.request<TicketValidationList>('GET', '/internal/v1/validations', {
      actorId: ctx.actorId,
      locale: ctx.locale,
      correlationId: ctx.correlationId,
      query: q,
    });
  }
}
