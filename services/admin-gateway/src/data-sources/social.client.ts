import type { ServiceHttp } from '../common/http-client';
import type { CallContext, ContentDailyStats, ModerationPost, Page, SocialProfile, SocialReport } from './types';

const opts = (ctx: CallContext) => ({ actorId: ctx.actorId, locale: ctx.locale, correlationId: ctx.correlationId });

export class SocialClient {
  constructor(private readonly http: ServiceHttp) {}

  listPostsByStatus(ctx: CallContext, q: { status?: string; cursor?: string; limit?: number }) {
    return this.http.request<Page<ModerationPost>>('GET', '/internal/v1/posts', { ...opts(ctx), query: { status: q.status ?? 'HIDDEN', cursor: q.cursor, limit: q.limit ?? 50 } });
  }

  listReports(ctx: CallContext, q: { status?: string; cursor?: string; limit?: number }) {
    return this.http.request<Page<SocialReport>>('GET', '/internal/v1/reports', { ...opts(ctx), query: { status: q.status ?? 'OPEN', cursor: q.cursor, limit: q.limit ?? 50 } });
  }

  resolveReport(ctx: CallContext, reportId: string, body: { resolution: string; note?: string }) {
    return this.http.request<SocialReport>('PATCH', `/internal/v1/reports/${reportId}`, { ...opts(ctx), body });
  }

  getProfile(ctx: CallContext, userId: string) {
    return this.http.request<SocialProfile>('GET', `/internal/v1/profiles/${userId}`, opts(ctx));
  }

  dailyStats(ctx: CallContext, from: string, to: string) {
    return this.http.request<ContentDailyStats>('GET', '/internal/v1/stats/daily', { ...opts(ctx), query: { from, to, topHashtags: 0 } });
  }
}
