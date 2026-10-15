import type { ServiceHttp } from '../common/http-client';
import type { CallContext, CreditStats } from './types';

export class WalletClient {
  constructor(private readonly http: ServiceHttp) {}

  creditStats(ctx: CallContext, from: string, to: string, groupBy: 'day' | 'week' | 'month') {
    return this.http.request<CreditStats>('GET', '/internal/v1/stats/credits', {
      actorId: ctx.actorId,
      locale: ctx.locale,
      correlationId: ctx.correlationId,
      query: { from, to, groupBy },
    });
  }
}
