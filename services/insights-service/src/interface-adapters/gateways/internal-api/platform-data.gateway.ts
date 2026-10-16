import { UpstreamUnavailableError } from '../../../entities/errors/domain-errors';
import { maskPersonalData } from '../../../entities/policies/number-fidelity';
import type {
  CallCtx,
  ContentRankingBy,
  ContentRankingsOut,
  ContentStatsOut,
  CreditStatsOut,
  EventRankingBy,
  EventRankingOut,
  FailedSagasOut,
  FlaggedContentOut,
  ListEventsOut,
  PlatformDataPort,
  QueryMetricsOut,
  RecentRegistrationsOut,
  RegistrationStatsOut,
  ServiceHealthOut,
  TicketStatsOut,
  TopSpendersOut,
  UserStatsOut,
  WalletOverviewOut,
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
interface RegistrationDto {
  id: string;
  userId: string;
  event: { id: string; title: string };
  status: string;
  priceCredits: number;
  ticketId: string | null;
  confirmedAt: string | null;
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

  async listRecentRegistrations(ctx: CallCtx, q: { from?: string; to?: string; status: string; eventId?: string; limit: number }): Promise<RecentRegistrationsOut> {
    const page = await this.client('events-service').get<Paged<RegistrationDto>>('/internal/v1/registrations', { from: q.from, to: q.to, status: q.status, eventId: q.eventId, limit: Math.min(PAGE, q.limit) }, this.actor(ctx));
    const names = await this.displayNames(ctx, page.items.map((r) => r.userId));
    return {
      truncated: Boolean(page.nextCursor),
      items: page.items.map((r) => ({
        registrationId: r.id,
        ticketId: r.ticketId ?? null,
        event: { id: r.event.id, title: r.event.title },
        buyer: { userId: r.userId, displayName: names.get(r.userId) ?? null },
        creditsPaid: r.priceCredits,
        status: r.status,
        confirmedAt: r.confirmedAt ?? null,
      })),
    };
  }

  async topCreditSpenders(ctx: CallCtx, q: { from: string; to: string; limit: number }): Promise<TopSpendersOut> {
    const raw = await this.client('wallet-service').get<{ from: string; to: string; items: { userId: string; creditsSpent: number; registrations: number }[] }>(
      '/internal/v1/stats/top-spenders',
      { from: q.from, to: q.to, limit: Math.min(20, q.limit) },
      this.actor(ctx),
    );
    const names = await this.displayNames(ctx, raw.items.map((i) => i.userId));
    return { from: raw.from, to: raw.to, items: raw.items.map((i) => ({ userId: i.userId, displayName: names.get(i.userId) ?? null, creditsSpent: i.creditsSpent, registrations: i.registrations })) };
  }

  /** Display names only (never email/phone) from social-service in one batch; a failure degrades to `null` names, the data is still useful. */
  private async displayNames(ctx: CallCtx, userIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    try {
      const res = await this.client('social-service').get<{ items: { userId: string; displayName: string }[] }>('/internal/v1/profiles', { ids: ids.join(',') }, this.actor(ctx));
      for (const p of res.items) out.set(p.userId, p.displayName);
    } catch {
      /* names are best effort */
    }
    return out;
  }

  async userStats(ctx: CallCtx, q: { from?: string; to?: string }): Promise<UserStatsOut> {
    const [users, careers] = await Promise.all([
      this.client('identity-service').get<Omit<UserStatsOut, 'byCareer'>>('/internal/v1/stats/users', { from: q.from, to: q.to }, this.actor(ctx)),
      this.client('social-service').get<{ items: { career: string; users: number }[] }>('/internal/v1/stats/careers', { limit: 10 }, this.actor(ctx)),
    ]);
    return {
      asOf: users.asOf,
      totalUsers: users.totalUsers,
      activeUsers: users.activeUsers,
      suspendedUsers: users.suspendedUsers,
      newUsers: users.newUsers ?? null,
      byStatus: users.byStatus,
      byUniversity: users.byUniversity.map((u) => ({ universityId: u.universityId, name: u.name, users: u.users })),
      byCareer: careers.items.slice(0, 10).map((c) => ({ career: c.career, users: c.users })),
    };
  }

  async walletOverview(ctx: CallCtx, q: { limit: number }): Promise<WalletOverviewOut> {
    const raw = await this.client('wallet-service').get<{ creditsInCirculation: number; walletsWithBalance: number; averageBalance: number; items: { userId: string; balanceCredits: number }[] }>(
      '/internal/v1/stats/balances',
      { limit: Math.min(20, q.limit) },
      this.actor(ctx),
    );
    const names = await this.displayNames(ctx, raw.items.map((i) => i.userId));
    return {
      creditsInCirculation: raw.creditsInCirculation,
      walletsWithBalance: raw.walletsWithBalance,
      averageBalance: raw.averageBalance,
      topBalances: raw.items.map((i) => ({ userId: i.userId, displayName: names.get(i.userId) ?? null, balanceCredits: i.balanceCredits })),
    };
  }

  async ticketStats(ctx: CallCtx, q: { from: string; to: string; eventId?: string }): Promise<TicketStatsOut> {
    return this.ticketStatsTop(ctx, q, 10);
  }

  private async ticketStatsTop(ctx: CallCtx, q: { from: string; to: string; eventId?: string }, topEvents: number): Promise<TicketStatsOut> {
    const raw = await this.client('ticketing-service').get<{
      from: string;
      to: string;
      issued: number;
      used: number;
      voided: number;
      usageRate: number;
      truncated: boolean;
      byEvent: { eventId: string; title: string; issued: number; used: number; voided: number }[];
    }>('/internal/v1/stats/tickets', { from: q.from, to: q.to, eventId: q.eventId }, this.actor(ctx));
    const rate = (used: number, issued: number) => (issued > 0 ? Math.round((used / issued) * 10_000) / 10_000 : 0);
    const byEvent = [...raw.byEvent]
      .sort((a, b) => b.used - a.used || b.issued - a.issued || a.eventId.localeCompare(b.eventId))
      .slice(0, topEvents)
      .map((e) => ({ eventId: e.eventId, title: e.title, issued: e.issued, used: e.used, usageRate: rate(e.used, e.issued) }));
    return { from: raw.from, to: raw.to, issued: raw.issued, used: raw.used, voided: raw.voided, usageRate: rate(raw.used, raw.issued), truncated: Boolean(raw.truncated), byEvent };
  }

  async contentRankings(ctx: CallCtx, q: { from: string; to: string; by: ContentRankingBy; limit: number }): Promise<ContentRankingsOut> {
    const raw = await this.client('social-service').get<{
      hashtags?: { hashtag: string; posts: number }[];
      authors?: { userId: string; posts: number }[];
      posts?: { postId: string; authorId: string; excerpt: string; reactions: number; comments: number }[];
    }>('/internal/v1/stats/rankings', { from: q.from, to: q.to, by: q.by, limit: Math.min(20, q.limit) }, this.actor(ctx));
    const base = { from: q.from, to: q.to, by: q.by };
    if (q.by === 'HASHTAGS') return { ...base, hashtags: (raw.hashtags ?? []).map((h) => ({ hashtag: h.hashtag, posts: h.posts })) };
    if (q.by === 'AUTHORS') {
      const names = await this.displayNames(ctx, (raw.authors ?? []).map((a) => a.userId));
      return { ...base, authors: (raw.authors ?? []).map((a) => ({ userId: a.userId, displayName: names.get(a.userId) ?? null, posts: a.posts })) };
    }
    const names = await this.displayNames(ctx, (raw.posts ?? []).map((p) => p.authorId));
    return {
      ...base,
      posts: (raw.posts ?? []).map((p) => ({
        postId: p.postId,
        excerpt: maskPersonalData(p.excerpt).slice(0, 80),
        author: { userId: p.authorId, displayName: names.get(p.authorId) ?? null },
        reactions: p.reactions,
        comments: p.comments,
      })),
    };
  }

  async eventRanking(ctx: CallCtx, q: { from: string; to: string; by: EventRankingBy; limit: number }): Promise<EventRankingOut> {
    type Row = { eventId: string; title: string; value: number; registrations: number; capacity: number; revenueCredits: number };
    const limit = Math.min(20, q.limit);
    const events = (query: Record<string, string | number | undefined>) =>
      this.client('events-service').get<{ items: Row[] }>('/internal/v1/stats/event-ranking', { from: q.from, to: q.to, ...query }, this.actor(ctx));
    if (q.by !== 'ATTENDANCE') {
      const raw = await events({ by: q.by, limit });
      return { from: q.from, to: q.to, by: q.by, items: raw.items.slice(0, limit).map((r) => ({ ...r, usedTickets: null })) };
    }
    // ATTENDANCE: ticketing-service knows who was admitted; events-service completes capacity, registrations and revenue of those events
    const tickets = await this.ticketStatsTop(ctx, { from: q.from, to: q.to }, 20);
    const top = tickets.byEvent.filter((e) => e.used > 0).slice(0, limit);
    if (top.length === 0) return { from: q.from, to: q.to, by: q.by, items: [] };
    const detail = await events({ by: 'REGISTRATIONS', ids: top.map((e) => e.eventId).join(',') });
    const byId = new Map(detail.items.map((r) => [r.eventId, r]));
    return {
      from: q.from,
      to: q.to,
      by: q.by,
      items: top.map((e) => {
        const d = byId.get(e.eventId);
        return { eventId: e.eventId, title: d?.title ?? e.title, value: e.used, registrations: d?.registrations ?? 0, capacity: d?.capacity ?? 0, revenueCredits: d?.revenueCredits ?? 0, usedTickets: e.used };
      }),
    };
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
