import { toUserErrors } from '../../common/errors';
import { clampFirst } from '../../common/relay';
import type { DataSources } from '../../data-sources/data-sources';
import type { RegistrationDto, SagaDto } from '../../data-sources/types';
import type { GatewayContext } from '../../graphql/context';

export class EventsService {
  constructor(private readonly ds: DataSources) {}

  async events(ctx: GatewayContext, args: { filter?: { from?: string | null; to?: string | null; status?: string | null; organizerId?: string | null; query?: string | null } | null; first?: number | null }) {
    const f = args.filter ?? {};
    const first = clampFirst(args.first, 50, 50);
    const page = await this.ds.events.listEvents(ctx.call, {
      startsFrom: f.from ?? undefined,
      startsTo: f.to ?? undefined,
      status: f.status ? [f.status] : undefined,
      limit: 50,
    });
    const q = f.query?.toLowerCase();
    return page.items
      .filter((e) => (!f.organizerId || e.organizerId === f.organizerId) && (!q || e.title.toLowerCase().includes(q)))
      .slice(0, first);
  }

  event(ctx: GatewayContext, id: string) {
    return this.ds.events.getEvent(ctx.call, id, ctx.bearer as string).catch((e: unknown) => {
      if (e && typeof e === 'object' && (e as { status?: number }).status === 404) return null;
      throw e;
    });
  }

  async registrations(ctx: GatewayContext, eventId: string, status?: string | null, first?: number | null): Promise<RegistrationDto[]> {
    const page = await this.ds.events.listRegistrations(ctx.call, eventId, { status: status ?? undefined, limit: clampFirst(first, 50, 50) });
    return page.items;
  }

  async sagas(ctx: GatewayContext, args: { status?: string | null; type?: string | null; since?: string | null; first?: number | null }): Promise<SagaDto[]> {
    const page = await this.ds.events.listSagas(ctx.call, {
      status: args.status ? [args.status] : undefined,
      type: args.type ?? undefined,
      since: args.since ?? undefined,
      limit: clampFirst(args.first, 50, 50),
    });
    return page.items;
  }

  async retrySaga(ctx: GatewayContext, id: string) {
    try {
      return { saga: await this.ds.events.retrySaga(ctx.call, id), errors: [] };
    } catch (e) {
      return { saga: null, errors: toUserErrors(e) };
    }
  }

  /** Sagas of the most recent window, indexed by registration (one call per request). */
  async sagaOf(ctx: GatewayContext, registrationId: string): Promise<SagaDto | null> {
    const all = await ctx.loaders.sagas.load('recent');
    return all.find((s) => s.registrationId === registrationId) ?? null;
  }
}
