import type { ServiceTokenProvider } from '@bandada/auth-ts';

import { type Problem, ServiceHttpError } from './errors';

export interface RequestOptions {
  query?: Record<string, string | number | boolean | string[] | undefined>;
  body?: unknown;
  /** Human on whose behalf the gateway acts (`X-Actor-Id`). */
  actorId?: string;
  locale?: string;
  correlationId?: string;
  /** Forward the user's own token instead of the service token (public `/api/v1` endpoints). */
  bearer?: string;
}

export interface HttpClientOptions {
  name: string;
  baseUrl: string;
  tokens: Pick<ServiceTokenProvider, 'authHeaders' | 'invalidate'>;
  timeoutMs: number;
  fetch?: typeof fetch;
}

/** HTTP access to one downstream service with service token, timeout, one retry on transport failure. */
export class ServiceHttp {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  get name(): string {
    return this.options.name;
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const idempotent = method === 'GET';
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.once<T>(method, path, opts);
      } catch (error) {
        const transient = error instanceof ServiceHttpError && (error.status === 0 || error.status === 502 || error.status === 503);
        if (!(idempotent && transient && attempt < 2)) throw error;
      }
    }
  }

  private async once<T>(method: string, path: string, opts: RequestOptions): Promise<T> {
    const url = new URL(this.options.baseUrl + path);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value === undefined) continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    const headers: Record<string, string> = opts.bearer
      ? { Authorization: `Bearer ${opts.bearer}` }
      : await this.serviceHeaders(opts);
    if (opts.bearer && opts.correlationId) headers['X-Correlation-Id'] = opts.correlationId;
    if (opts.locale) headers['Accept-Language'] = opts.locale;
    headers.Accept = 'application/json';
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (cause) {
      throw new ServiceHttpError(this.options.name, 0, undefined, `${this.options.name} unreachable: ${(cause as Error).message}`);
    }
    if (response.status === 401 && !opts.bearer) this.options.tokens.invalidate();
    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!response.ok) throw new ServiceHttpError(this.options.name, response.status, json as Problem | undefined);
    return json as T;
  }

  private async serviceHeaders(opts: RequestOptions): Promise<Record<string, string>> {
    try {
      return await this.options.tokens.authHeaders({ actorId: opts.actorId, correlationId: opts.correlationId });
    } catch (cause) {
      throw new ServiceHttpError(this.options.name, 503, undefined, `service token unavailable: ${(cause as Error).message}`);
    }
  }
}
