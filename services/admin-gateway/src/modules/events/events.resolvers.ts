import type { EventDto, RegistrationDto, SagaDto } from '../../data-sources/types';
import type { GatewayContext } from '../../graphql/context';
import type { EventsService } from './events.service';

type Ctx = GatewayContext;

export function eventsResolvers(service: EventsService) {
  return {
    Query: {
      events: (_: unknown, args: never, ctx: Ctx) => service.events(ctx, args),
      event: (_: unknown, args: { id: string }, ctx: Ctx) => service.event(ctx, args.id),
      registrations: (_: unknown, a: { eventId: string; status?: string; first?: number }, ctx: Ctx) => service.registrations(ctx, a.eventId, a.status, a.first),
      sagas: (_: unknown, args: never, ctx: Ctx) => service.sagas(ctx, args),
    },
    Mutation: {
      retrySaga: (_: unknown, a: { id: string }, ctx: Ctx) => service.retrySaga(ctx, a.id),
    },
    Event: {
      organizer: (e: EventDto, _: unknown, ctx: Ctx) => ctx.loaders.users.load(e.organizerId),
      registrations: (e: EventDto, _: unknown, ctx: Ctx) => service.registrations(ctx, e.id),
      description: (e: EventDto) => e.description ?? null,
    },
    Registration: {
      user: (r: RegistrationDto, _: unknown, ctx: Ctx) => ctx.loaders.users.load(r.userId),
      saga: (r: RegistrationDto, _: unknown, ctx: Ctx) => service.sagaOf(ctx, r.id),
    },
    SagaInstance: {
      failureReason: (s: SagaDto) => s.failureReason ?? null,
    },
  };
}
