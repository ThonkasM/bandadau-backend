import { UpstreamUnavailableError } from '../../../entities/errors/domain-errors';
import type {
  CallCtx,
  ContentStatsOut,
  CreditStatsOut,
  FailedSagasOut,
  FlaggedContentOut,
  ListEventsOut,
  PlatformDataPort,
  QueryMetricsOut,
  RegistrationStatsOut,
  ServiceHealthOut,
} from '../../../use-cases/ports/platform-data.port';
import { type AuthHeaders, collectPages, collectPagesInfo, JsonClient, type Paged } from './http-json';

export interface PlatformDataOptions {
  services: Record<string, string>;
  tokens: AuthHeaders;
  timeoutMs?: number;
  rabbit: { url: string; user: string; password: string };
  prometheusUrl?: string;
  fetch?: typeof fetch;
}

const PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVICE_NAMES = ['identity-service', 'social-service', 'media-service', 'events-service', 'wallet-service', 'ticketing-service', 'notification-service', 'insights-service', 'admin-gateway'];

interface RegStats {
  totals: { pending: number; confirmed: number; failed: number; cancelled: number };
  series: { key: string; label?: string; pending: number; confirmed: number; failed: number; cancelled: number }[];
}
interface EventDto {
  id: string;
  title: string;
  startsAt: string;
  venue: string;
  capacity: number;
  seatsTaken: number;
  priceCredits: number;
  status: string;
}
interface SagaDto {
  id: string;
  type: 'REGISTRATION' | 'CANCELLATION';
  registrationId: string;
  eventId: string;
  step: string;
  status: 'FAILED' | 'COMPENSATED';
  failureReason: string | null;
  updatedAt: string;
}
interface MediaDto {
  id: string;
  ownerId: string;
  kind: 'IMAGE' | 'VIDEO';
  updatedAt: string;
  createdAt: string;
  moderationResults?: { labels: string[]; scores: Record<string, number> }[];
}
interface PostDto {
  id: string;
  authorId: string;
  reportsCount: number;
  updatedAt: string;
  createdAt: string;
}
interface DailyStats {
  days: { date: string; postsCreated: number; commentsCreated: number; reactionsSet: number }[];
  topHashtags?: { hashtag: string; count: number }[];
}

/** Adapter over the `/internal/v1` REST APIs of events, wallet, social and media, the `/health/ready` probes, RabbitMQ management and Prometheus. */
export class PlatformDataGateway implements PlatformDataPort {
  private readonly clients = new Map<string, JsonClient>();
  private readonly timeoutMs: number;

  constructor(private readonly o: PlatformDataOptions) {
    this.timeoutMs = o.timeoutMs ?? 5000;
  }

  private client(service: string): JsonClient {
    let c = this.clients.get(service);
    if (!c) {
      const baseUrl = this.o.services[service];
      if (!baseUrl) throw new UpstreamUnavailableError(service, `no URL configured for ${service}`);
      c = new JsonClient({ name: service, baseUrl, tokens: this.o.tokens, timeoutMs: this.timeoutMs, fetch: this.o.fetch });
      this.clients.set(service, c);
    }
    return c;
  }
  private actor = (ctx: CallCtx) => ({ actorId: ctx.actorId && UUID.test(ctx.actorId) ? ctx.actorId : undefined, correlationId: ctx.correlationId });

  async registrationStats(ctx: CallCtx, q: { from: string; to: string; groupBy: 'day' | 'event' | 'status'; eventId?: string }): Promise<RegistrationStatsOut> {
    // `status` grouping is derived from the totals; the endpoint serves `day` and `event`
    const raw = await this.client('events-service').get<RegStats>('/internal/v1/stats/registrations', { from: q.from, to: q.to, groupBy: q.groupBy === 'status' ? 'day' : q.groupBy, eventId: q.eventId }, this.actor(ctx));
    const t = raw.totals;
    const rows =
      q.groupBy === 'status'
        ? (['PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED'] as const).map((s) => {
            const n = t[s.toLowerCase() as 'pending' | 'confirmed' | 'failed' | 'cancelled'];
            return { key: s, confirmed: s === 'CONFIRMED' ? n : 0, failed: s === 'FAILED' ? n : 0, cancelled: s === 'CANCELLED' ? n : 0, pending: s === 'PENDING' ? n : 0 };
          })
        : raw.series.map((s) => ({ key: s.key, ...(q.groupBy === 'event' && s.label ? { label: s.label } : {}), confirmed: s.confirmed, failed: s.failed, cancelled: s.cancelled, pending: s.pending }));
    return { from: q.from, to: q.to, groupBy: q.groupBy, rows, totals: { confirmed: t.confirmed, failed: t.failed, cancelled: t.cancelled, pending: t.pending } };
  }

  async listEvents(ctx: CallCtx, q: { from: string; to: string; status?: string; limit: number }): Promise<ListEventsOut> {
    const { items, truncated } = await collectPagesInfo(
      (cursor) => this.client('events-service').get<Paged<EventDto>>('/internal/v1/events', { startsFrom: q.from, startsTo: q.to, status: q.status, cursor, limit: Math.min(PAGE, q.limit) }, this.actor(ctx)),
      q.limit,
    );
    return { truncated, items: items.map((e) => ({ eventId: e.id, title: e.title, startsAt: e.startsAt, venue: e.venue, capacity: e.capacity, seatsTaken: e.seatsTaken, priceCredits: e.priceCredits, status: e.status })) };
  }

  creditStats(ctx: CallCtx, q: { from: string; to: string; groupBy: 'day' | 'week' | 'month' }): Promise<CreditStatsOut> {
    return this.client('wallet-service').get<CreditStatsOut>('/internal/v1/stats/credits', q, this.actor(ctx));
  }

  async contentStats(ctx: CallCtx, q: { from: string; to: string; topHashtags: number }): Promise<ContentStatsOut> {
    const raw = await this.client('social-service').get<DailyStats>('/internal/v1/stats/daily', q, this.actor(ctx));
    const daily = raw.days.map((d) => ({ date: d.date, posts: d.postsCreated, comments: d.commentsCreated, reactions: d.reactionsSet }));
    const sum = (k: 'posts' | 'comments' | 'reactions') => daily.reduce((n, d) => n + d[k], 0);
    return {
      from: q.from,
      to: q.to,
      totals: { posts: sum('posts'), comments: sum('comments'), reactions: sum('reactions') },
      // social-service does not break reactions down by type yet (documented divergence): the total is exact, the split is not available
      reactionsByType: { LIKE: 0, HELPFUL: 0, FUNNY: 0, SUPPORT: 0 },
      daily,
      topHashtags: (raw.topHashtags ?? []).slice(0, q.topHashtags),
    };
  }

  async flaggedContent(ctx: CallCtx, q: { source: 'AI' | 'REPORTS' | 'ALL'; limit: number }): Promise<FlaggedContentOut> {
    const wantAi = q.source !== 'REPORTS';
    const wantReports = q.source !== 'AI';
    const [media, posts] = await Promise.all([
      wantAi ? collectPages((cursor) => this.client('media-service').get<Paged<MediaDto>>('/internal/v1/media', { status: 'FLAGGED', cursor, limit: PAGE }, this.actor(ctx)), 200) : Promise.resolve([] as MediaDto[]),
      wantReports ? collectPages((cursor) => this.client('social-service').get<Paged<PostDto>>('/internal/v1/posts', { status: 'HIDDEN', cursor, limit: PAGE }, this.actor(ctx)), 200) : Promise.resolve([] as PostDto[]),
    ]);
    const items: FlaggedContentOut['items'] = [
      ...media.map((m) => {
        const results = m.moderationResults ?? [];
        const scores = results.flatMap((r) => Object.values(r.scores ?? {}));
        return {
          id: m.id,
          source: 'AI' as const,
          kind: m.kind,
          authorId: m.ownerId,
          maxScore: scores.length ? Math.max(...scores) : null,
          labels: [...new Set(results.flatMap((r) => r.labels ?? []))],
          enqueuedAt: m.updatedAt ?? m.createdAt,
        };
      }),
      ...posts.map((p) => ({ id: p.id, source: 'REPORTS' as const, kind: 'POST' as const, authorId: p.authorId, openReports: p.reportsCount, enqueuedAt: p.updatedAt ?? p.createdAt })),
    ].sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));
    return { totalPending: items.length, oldestEnqueuedAt: items[0]?.enqueuedAt ?? null, items: items.slice(0, q.limit) };
  }

  async failedSagas(ctx: CallCtx, q: { status?: 'FAILED' | 'COMPENSATED'; since?: string; limit: number }): Promise<FailedSagasOut> {
    const sagas = await collectPages(
      (cursor) => this.client('events-service').get<Paged<SagaDto>>('/internal/v1/sagas', { status: q.status ?? 'FAILED,COMPENSATED', since: q.since, cursor, limit: PAGE }, this.actor(ctx)),
      q.limit,
    );
    const byFailureReason: Record<string, number> = {};
    for (const s of sagas) byFailureReason[s.failureReason ?? 'UNKNOWN'] = (byFailureReason[s.failureReason ?? 'UNKNOWN'] ?? 0) + 1;
    return {
      count: sagas.length,
      byFailureReason,
      items: sagas.map((s) => ({ sagaId: s.id, registrationId: s.registrationId, eventId: s.eventId, type: s.type, status: s.status, failedStep: s.step, failureReason: s.failureReason ?? 'UNKNOWN', updatedAt: s.updatedAt })),
    };
  }

  async serviceHealth(_ctx: CallCtx, q: { includeQueues: boolean }): Promise<ServiceHealthOut> {
    const f = this.o.fetch ?? fetch;
    const probe = async (name: string): Promise<ServiceHealthOut['services'][number]> => {
      const base = this.o.services[name];
      const t0 = Date.now();
      if (!base) return { name, status: 'DOWN', latencyMs: null, error: 'no URL configured' };
      try {
        const res = await f(`${base}/health/ready`, { signal: AbortSignal.timeout(3000) });
        const latencyMs = Date.now() - t0;
        const body = (await res.json().catch(() => ({}))) as { status?: string; checks?: Record<string, string> };
        if (res.ok) return { name, status: body.status === 'DEGRADED' ? 'DEGRADED' : 'UP', latencyMs, ...(body.checks ? { checks: body.checks } : {}) };
        return { name, status: 'DOWN', latencyMs, error: `HTTP ${res.status}`, ...(body.checks ? { checks: body.checks } : {}) };
      } catch (error) {
        return { name, status: 'DOWN', latencyMs: null, error: (error as Error).name === 'TimeoutError' ? 'timeout (3 s)' : (error as Error).message.slice(0, 120) };
      }
    };
    const [services, queues] = await Promise.all([Promise.all(SERVICE_NAMES.map(probe)), q.includeQueues ? this.queues() : Promise.resolve([])]);
    const overall = services.some((s) => s.status === 'DOWN') ? 'DOWN' : services.some((s) => s.status === 'DEGRADED') ? 'DEGRADED' : 'UP';
    return { checkedAt: new Date().toISOString(), overall, services, queues };
  }

  private async queues(): Promise<ServiceHealthOut['queues']> {
    try {
      const mgmt = new JsonClient({ name: 'rabbitmq', baseUrl: this.o.rabbit.url, timeoutMs: 3000, fetch: this.o.fetch, basicAuth: { user: this.o.rabbit.user, password: this.o.rabbit.password } });
      const raw = await mgmt.get<{ name: string; messages_ready?: number; messages_unacknowledged?: number; consumers?: number }[]>('/api/queues', { columns: 'name,messages_ready,messages_unacknowledged,consumers' });
      return raw.map((qu) => ({ name: qu.name, messagesReady: qu.messages_ready ?? 0, messagesUnacked: qu.messages_unacknowledged ?? 0, consumers: qu.consumers ?? 0, isDeadLetter: qu.name.endsWith('.dlq') }));
    } catch {
      return [];
    }
  }

  async queryMetrics(_ctx: CallCtx, q: { query: string; start?: string; end?: string; step?: string }): Promise<QueryMetricsOut> {
    if (!this.o.prometheusUrl) throw new UpstreamUnavailableError('prometheus', 'Prometheus is not configured (start the observability profile and set PROMETHEUS_URL).');
    const prom = new JsonClient({ name: 'prometheus', baseUrl: this.o.prometheusUrl, timeoutMs: 10_000, fetch: this.o.fetch });
    const range = q.start && q.end;
    const raw = await prom.get<{ data: { resultType: 'vector' | 'matrix' | 'scalar'; result: unknown } }>(
      range ? '/api/v1/query_range' : '/api/v1/query',
      range ? { query: q.query, start: q.start, end: q.end, step: q.step ?? '60s' } : { query: q.query },
    );
    const { resultType, result } = raw.data;
    let truncated = false;
    const toPoint = (p: [number, string]) => ({ t: new Date(p[0] * 1000).toISOString(), v: Number.isFinite(Number(p[1])) ? Number(p[1]) : null });
    let series: QueryMetricsOut['series'] = [];
    if (resultType === 'scalar') series = [{ labels: {}, points: [toPoint(result as [number, string])] }];
    else
      series = (result as { metric: Record<string, string>; value?: [number, string]; values?: [number, string][] }[]).map((r) => ({
        labels: r.metric,
        points: (r.values ?? (r.value ? [r.value] : [])).map(toPoint),
      }));
    if (series.length > 50) {
      series = series.slice(0, 50);
      truncated = true;
    }
    series = series.map((s) => {
      if (s.points.length > 500) {
        truncated = true;
        return { ...s, points: s.points.slice(-500) };
      }
      return s;
    });
    return { resultType, series, truncated, executedAt: new Date().toISOString() };
  }
}
