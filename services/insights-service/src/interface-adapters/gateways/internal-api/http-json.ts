import { DomainError, UpstreamUnavailableError } from '../../../entities/errors/domain-errors';

export interface AuthHeaders {
  authHeaders(extra?: { actorId?: string; correlationId?: string }): Promise<Record<string, string>>;
  invalidate(): void;
}

export interface JsonClientOptions {
  name: string;
  baseUrl: string;
  tokens?: AuthHeaders;
  timeoutMs: number;
  fetch?: typeof fetch;
  basicAuth?: { user: string; password: string };
}

/** Minimal JSON client for `/internal/v1` calls: service token, timeout, one retry on transport failure for GET. */
export class JsonClient {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly o: JsonClientOptions) {
    this.fetchImpl = o.fetch ?? fetch;
  }

  async get<T>(path: string, query: Record<string, string | number | undefined> = {}, ctx: { actorId?: string; correlationId?: string } = {}): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.once<T>(path, query, ctx);
      } catch (error) {
        if (!(error instanceof UpstreamUnavailableError) || attempt >= 2) throw error;
      }
    }
  }

  private async once<T>(path: string, query: Record<string, string | number | undefined>, ctx: { actorId?: string; correlationId?: string }): Promise<T> {
    const url = new URL(this.o.baseUrl + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.o.tokens) {
      try {
        Object.assign(headers, await this.o.tokens.authHeaders(ctx));
      } catch (cause) {
        throw new UpstreamUnavailableError(this.o.name, `service token unavailable: ${(cause as Error).message}`);
      }
    }
    if (this.o.basicAuth) headers.Authorization = `Basic ${Buffer.from(`${this.o.basicAuth.user}:${this.o.basicAuth.password}`).toString('base64')}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(this.o.timeoutMs) });
    } catch (cause) {
      throw new UpstreamUnavailableError(this.o.name, `${this.o.name} unreachable: ${(cause as Error).message}`);
    }
    if (res.status === 401) this.o.tokens?.invalidate();
    const text = await res.text();
    if (res.status >= 500) throw new UpstreamUnavailableError(this.o.name, `${this.o.name} responded ${res.status}`);
    if (!res.ok) throw new DomainError('UPSTREAM_ERROR', `${this.o.name} rejected the request (${res.status}): ${text.slice(0, 200)}`, { service: this.o.name, status: res.status });
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

/** Follows `nextCursor` until `max` items or `maxPages` (internal pages are capped at 50 by the contract). */
export async function collectPages<T>(fetchPage: (cursor: string | undefined) => Promise<Paged<T>>, max: number, maxPages = 6): Promise<T[]> {
  return (await collectPagesInfo(fetchPage, max, maxPages)).items;
}

/** Same as `collectPages`, also telling whether more items existed beyond `max`. */
export async function collectPagesInfo<T>(fetchPage: (cursor: string | undefined) => Promise<Paged<T>>, max: number, maxPages = 6): Promise<{ items: T[]; truncated: boolean }> {
  const out: T[] = [];
  let cursor: string | undefined;
  let more = false;
  for (let i = 0; i < maxPages && out.length < max; i++) {
    const page = await fetchPage(cursor);
    out.push(...page.items);
    more = page.nextCursor !== null && page.nextCursor !== undefined;
    if (!more) break;
    cursor = page.nextCursor as string;
  }
  return { items: out.slice(0, max), truncated: more || out.length > max };
}
