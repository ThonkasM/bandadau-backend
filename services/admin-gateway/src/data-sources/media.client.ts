import type { ServiceHttp } from '../common/http-client';
import type { CallContext, MediaUrl, ModeratedMedia, Page } from './types';

const opts = (ctx: CallContext) => ({ actorId: ctx.actorId, locale: ctx.locale, correlationId: ctx.correlationId });

export class MediaClient {
  constructor(private readonly http: ServiceHttp) {}

  listFlagged(ctx: CallContext, q: { status?: string; cursor?: string; limit?: number }) {
    return this.http.request<Page<ModeratedMedia>>('GET', '/internal/v1/media', { ...opts(ctx), query: { status: q.status ?? 'FLAGGED', cursor: q.cursor, limit: q.limit ?? 50 } });
  }

  getMedia(ctx: CallContext, mediaId: string) {
    return this.http.request<ModeratedMedia>('GET', `/internal/v1/media/${mediaId}`, opts(ctx));
  }

  async getUrls(ctx: CallContext, ids: string[]): Promise<MediaUrl[]> {
    const out: MediaUrl[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const res = await this.http.request<{ items: MediaUrl[] }>('GET', '/internal/v1/media/urls', {
        ...opts(ctx),
        query: { ids: ids.slice(i, i + 50), includeUnapproved: true },
      });
      out.push(...res.items);
    }
    return out;
  }

  decide(ctx: CallContext, mediaId: string, body: { decision: 'APPROVE' | 'REJECT'; note?: string }) {
    return this.http.request<ModeratedMedia>('POST', `/internal/v1/media/${mediaId}/decision`, { ...opts(ctx), body });
  }
}
