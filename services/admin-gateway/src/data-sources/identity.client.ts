import type { ServiceHttp } from '../common/http-client';
import type { CallContext, IdentityMcpToken, IdentityUniversity, IdentityUser, Page } from './types';

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

  /** Public `POST /api/v1/auth/mcp-tokens` with the ADMIN's own token (UC-22). Exempt from Idempotency-Key in the contract: every call issues a new token. */
  createMcpToken(ctx: CallContext, bearer: string, label?: string | null) {
    return this.http.request<IdentityMcpToken>('POST', '/api/v1/auth/mcp-tokens', { ...opts(ctx), bearer, body: label ? { label } : {} });
  }

  /** Public `DELETE /api/v1/auth/mcp-tokens/{id}` (204; revoking twice is also 204). */
  async revokeMcpToken(ctx: CallContext, bearer: string, id: string): Promise<void> {
    await this.http.request<void>('DELETE', `/api/v1/auth/mcp-tokens/${id}`, { ...opts(ctx), bearer });
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

  updateUniversity(ctx: CallContext, id: string, patch: { name?: string | null; allowedDomains?: string[] | null; enabled?: boolean | null }) {
    const body = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null && v !== undefined));
    return this.http.request<IdentityUniversity>('PATCH', `/internal/v1/universities/${id}`, { ...opts(ctx), body });
  }
}
