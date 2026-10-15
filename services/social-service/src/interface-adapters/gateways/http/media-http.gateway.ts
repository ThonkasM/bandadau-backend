import type { ServiceTokenProvider } from '@bandada/auth-ts';

import { DomainError } from '../../../entities/errors/domain-error';
import type { MediaAssetInfo, MediaGateway, MediaUrlInfo } from '../../../use-cases/ports';
import { requestContext } from '../../request-context';

export interface MediaHttpGatewayOptions {
  baseUrl: string;
  tokens: ServiceTokenProvider;
  timeoutMs?: number;
  /** Consecutive failures that open the circuit for the batched URL lookup. */
  breakerThreshold?: number;
  breakerOpenMs?: number;
  fetch?: typeof fetch;
}

/** REST client of media-service `/internal/v1/media` with timeout and a small circuit breaker (feed degrades without URLs). */
export class MediaHttpGateway implements MediaGateway {
  private failures = 0;
  private openUntil = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: MediaHttpGatewayOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 1500;
  }

  async getAssets(ids: readonly string[]): Promise<MediaAssetInfo[]> {
    const results = await Promise.all(
      [...new Set(ids)].map(async (id) => {
        const res = await this.request(`/internal/v1/media/${encodeURIComponent(id)}`).catch((error: unknown) => {
          throw new DomainError('SERVICE_UNAVAILABLE', { cause: String(error) });
        });
        if (res.status === 404) return null;
        if (!res.ok) throw new DomainError('SERVICE_UNAVAILABLE', { status: res.status });
        const d = (await res.json()) as { id: string; ownerId: string; kind: MediaAssetInfo['kind']; purpose: string; status: MediaAssetInfo['status'] };
        return { mediaId: d.id, ownerId: d.ownerId, kind: d.kind, purpose: d.purpose, status: d.status } satisfies MediaAssetInfo;
      }),
    );
    return results.filter((r): r is MediaAssetInfo => r !== null);
  }

  async getUrls(ids: readonly string[]): Promise<MediaUrlInfo[]> {
    if (ids.length === 0 || Date.now() < this.openUntil) return [];
    const query = new URLSearchParams();
    for (const id of ids) query.append('ids', id);
    try {
      const res = await this.request(`/internal/v1/media/urls?${query.toString()}`);
      if (!res.ok) throw new Error(`media-service ${res.status}`);
      const body = (await res.json()) as { items: MediaUrlInfo[] };
      this.failures = 0;
      return body.items;
    } catch {
      this.failures += 1;
      if (this.failures >= (this.options.breakerThreshold ?? 3)) this.openUntil = Date.now() + (this.options.breakerOpenMs ?? 10_000);
      return [];
    }
  }

  private async request(path: string, retry = true): Promise<Response> {
    const rc = requestContext.get();
    const headers = await this.options.tokens.authHeaders(rc ? { correlationId: rc.correlationId } : {});
    const res = await this.fetchImpl(`${this.options.baseUrl}${path}`, { headers: { ...headers, accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (res.status === 401 && retry) {
      this.options.tokens.invalidate();
      return this.request(path, false);
    }
    return res;
  }
}
