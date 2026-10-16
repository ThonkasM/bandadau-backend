import { AuthError, type AuthPrincipal, createJwtVerifier, extractBearerToken, type JwtVerifier } from '@bandada/auth-ts';

import type { McpTokenStatusChecker } from './mcp-token-status';

export interface McpAuthOptions {
  jwksUrl: string;
  issuer: string;
  serviceClients: string[];
  requireServiceScope: boolean;
  /** Tests inject verifiers. */
  userVerifier?: JwtVerifier;
  serviceVerifier?: JwtVerifier;
  /** Checks MCP tokens (aud `mcp`) against identity; without it they are accepted on signature alone (tests only). */
  tokenStatus?: McpTokenStatusChecker;
}

/**
 * `/mcp` credentials (mcp.md 3): ADMIN JWT (aud `bandada-admin`, or the MCP token aud `mcp` + scope `mcp:tools`) or a service token
 * of an allowed client. 401 for missing/invalid, 403 for authenticated but not allowed.
 */
export class McpAuthenticator {
  private readonly user: JwtVerifier;
  private readonly service: JwtVerifier;

  constructor(private readonly o: McpAuthOptions) {
    const base = { jwksUrl: o.jwksUrl, issuer: o.issuer };
    this.user = o.userVerifier ?? createJwtVerifier({ ...base, audience: ['bandada-admin', 'mcp'], allowedTypes: ['user'] });
    this.service = o.serviceVerifier ?? createJwtVerifier({ ...base, audience: 'bandada-internal', allowedTypes: ['service'] });
  }

  async authenticate(authorization: string | string[] | undefined): Promise<AuthPrincipal> {
    const token = extractBearerToken(authorization);
    let typ: unknown;
    try {
      // unverified peek only to choose the verifier; the signature is checked by the verifier itself
      typ = (JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { typ?: unknown }).typ;
    } catch {
      throw AuthError.unauthorized('Malformed access token');
    }
    if (typ === 'service') {
      const p = await this.service.verify(token);
      const client = p.sub.replace(/^service:/, '');
      if (!this.o.serviceClients.includes(client)) throw AuthError.forbidden('This service client may not use MCP');
      if (this.o.requireServiceScope && !p.scopes.includes('mcp:tools')) throw AuthError.forbidden('Missing scope mcp:tools');
      return p;
    }
    const p = await this.user.verify(token);
    if (!p.roles.includes('ADMIN')) throw AuthError.forbidden('MCP requires the ADMIN role');
    if (p.aud.includes('mcp') && !p.aud.includes('bandada-admin') && !p.scopes.includes('mcp:tools')) throw AuthError.forbidden('Missing scope mcp:tools');
    if (p.aud.includes('mcp') && !p.aud.includes('bandada-admin')) await this.assertMcpTokenActive(p);
    return p;
  }

  /** Revoked or unknown `jti` -> 401; identity down -> 503 (fail closed, only for MCP tokens). */
  private async assertMcpTokenActive(p: AuthPrincipal): Promise<void> {
    if (!this.o.tokenStatus) return;
    if (!p.jti) throw AuthError.unauthorized('MCP token without jti');
    let state;
    try {
      state = await this.o.tokenStatus.check(p.jti);
    } catch (cause) {
      throw new AuthError('SERVICE_UNAVAILABLE', 503, 'Cannot verify the MCP token right now', { cause });
    }
    if (state !== 'active') throw AuthError.unauthorized(state === 'revoked' ? 'MCP token revoked' : 'Unknown MCP token');
  }
}
