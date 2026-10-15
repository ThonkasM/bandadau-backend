import type { ServiceHttp } from '../common/http-client';
import type { CallContext, EventDto, Page, RegistrationDto, RegistrationStats, SagaDto } from './types';

const opts = (ctx: CallContext) => ({ actorId: ctx.actorId, locale: ctx.locale, correlationId: ctx.correlationId });

export class EventsClient {
  constructor(private readonly http: ServiceHttp) {}

  listEvents(ctx: CallContext, q: { startsFrom?: string; startsTo?: string; status?: string[]; cursor?: string; limit?: number }) {
    return this.http.request<Page<EventDto>>('GET', '/internal/v1/events', { ...opts(ctx), query: { ...q, limit: q.limit ?? 50 } });
  }

  /** Internal `/internal/v1/events/{id}` with the service token (any status, D-6). */
  getEvent(ctx: CallContext, eventId: string) {
    return this.http.request<EventDto>('GET', `/internal/v1/events/${eventId}`, opts(ctx));
  }

  listRegistrations(ctx: CallContext, eventId: string, q: { status?: string; cursor?: string; limit?: number }) {
    return this.http.request<Page<RegistrationDto>>('GET', `/internal/v1/events/${eventId}/registrations`, { ...opts(ctx), query: { ...q, limit: q.limit ?? 50 } });
  }

  listSagas(ctx: CallContext, q: { status?: string[]; type?: string; since?: string; cursor?: string; limit?: number }) {
    return this.http.request<Page<SagaDto>>('GET', '/internal/v1/sagas', { ...opts(ctx), query: { ...q, limit: q.limit ?? 50 } });
  }

  retrySaga(ctx: CallContext, sagaId: string) {
    return this.http.request<SagaDto>('POST', `/internal/v1/sagas/${sagaId}/retry`, opts(ctx));
  }

  registrationStats(ctx: CallContext, from: string, to: string) {
    return this.http.request<RegistrationStats>('GET', '/internal/v1/stats/registrations', { ...opts(ctx), query: { from, to, groupBy: 'day' } });
  }
}
