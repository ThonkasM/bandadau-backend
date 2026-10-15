import type { ServiceHttp } from '../common/http-client';
import type { CallContext, IdentityUniversity, IdentityUser, Page } from './types';

const opts = (ctx: CallContext) => ({ actorId: ctx.actorId, locale: ctx.locale, correlationId: ctx.correlationId });

export class IdentityClient {
  constructor(private readonly http: ServiceHttp) {}

  searchUsers(ctx: CallContext, q: { query?: string; status?: string; role?: string; universityId?: string; ids?: string[]; cursor?: string; limit?: number }) {
    return this.http.request<Page<IdentityUser>>('GET', '/internal/v1/users', { ...opts(ctx), query: { ...q, limit: q.limit ?? 20 } });
  }

  /** Public `/api/v1/users/me` with the caller's own token. */
  getMe(ctx: CallContext, bearer: string) {
    return this.http.request<IdentityUser>('GET', '/api/v1/users/me', { ...opts(ctx), bearer });
  }

  updateRoles(ctx: CallContext, userId: string, roles: string[]) {
    return this.http.request<IdentityUser>('PATCH', `/internal/v1/users/${userId}/roles`, { ...opts(ctx), body: { roles } });
  }

  updateStatus(ctx: CallContext, userId: string, status: 'ACTIVE' | 'SUSPENDED', reason?: string) {
    return this.http.request<IdentityUser>('PATCH', `/internal/v1/users/${userId}/status`, { ...opts(ctx), body: { status, ...(reason ? { reason } : {}) } });
  }

  /** Public `/api/v1/universities` (no auth), all pages. */
  async listUniversities(ctx: CallContext): Promise<IdentityUniversity[]> {
    const all: IdentityUniversity[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.http.request<Page<IdentityUniversity>>('GET', '/api/v1/universities', { ...opts(ctx), bearer: undefined, query: { cursor, limit: 50 } }).catch((e) => {
        throw e;
      });
      all.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor && all.length < 1000);
    return all;
  }

  createUniversity(ctx: CallContext, input: { name: string; allowedDomains: string[] }) {
    return this.http.request<IdentityUniversity>('POST', '/internal/v1/universities', { ...opts(ctx), body: input });
  }
}
