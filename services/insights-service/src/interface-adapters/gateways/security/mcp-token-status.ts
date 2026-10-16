import { DomainError } from '../../../entities/errors/domain-errors';
import { type AuthHeaders,JsonClient } from '../internal-api/http-json';

export type McpTokenState = 'active' | 'revoked' | 'unknown';

/** Port used by `McpAuthenticator`; throws when identity cannot answer (the caller fails closed). */
export interface McpTokenStatusChecker {
  check(jti: string): Promise<McpTokenState>;
}

interface McpTokenStatusDto {
  id: string;
  revoked: boolean;
  expiresAt: string;
}

export interface IdentityMcpTokenStatusOptions {
  identityUrl: string;
  tokens: AuthHeaders;
  timeoutMs?: number;
  /** How long a verdict is reused; revocation takes effect within this window. */
  cacheTtlMs?: number;
  now?: () => number;
  fetch?: typeof fetch;
}

/**
 * Asks identity (`GET /internal/v1/mcp-tokens/{jti}`, getMcpTokenStatus, scope internal:read) whether an MCP token is
 * still valid (UC-22, ADR-0016). Verdicts are cached for a few seconds. Errors are never cached.
 */
export class IdentityMcpTokenStatus implements McpTokenStatusChecker {
  private readonly http: JsonClient;
  private readonly cache = new Map<string, { state: McpTokenState; until: number }>();
  private readonly ttl: number;
  private readonly now: () => number;

  constructor(o: IdentityMcpTokenStatusOptions) {
    this.http = new JsonClient({ name: 'identity-service', baseUrl: o.identityUrl, tokens: o.tokens, timeoutMs: o.timeoutMs ?? 2000, fetch: o.fetch });
    this.ttl = o.cacheTtlMs ?? 5000;
    this.now = o.now ?? Date.now;
  }

  async check(jti: string): Promise<McpTokenState> {
    const t = this.now();
    const hit = this.cache.get(jti);
    if (hit && hit.until > t) return hit.state;
    let state: McpTokenState;
    try {
      const dto = await this.http.get<McpTokenStatusDto>(`/internal/v1/mcp-tokens/${encodeURIComponent(jti)}`);
      state = dto.revoked || Date.parse(dto.expiresAt) <= t ? 'revoked' : 'active';
    } catch (error) {
      if (error instanceof DomainError && error.details.status === 404) state = 'unknown';
      else throw error;
    }
    if (this.cache.size > 500) for (const [k, v] of this.cache) if (v.until <= t) this.cache.delete(k);
    this.cache.set(jti, { state, until: t + this.ttl });
    return state;
  }
}
