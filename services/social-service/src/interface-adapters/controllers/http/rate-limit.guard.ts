import { type CanActivate, type ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

import type { RequestWithPrincipal } from '@bandada/auth-ts/nest';

export const RATE_LIMIT_OPTIONS = Symbol('RateLimitOptions');
export interface RateLimitOptions {
  perMinute: number;
}

/** Fixed one-minute window per principal (`sub`) or IP. In-memory: enough for one replica in phase 1; Traefik adds the edge limit. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private windowStart = 0;
  private readonly hits = new Map<string, number>();

  constructor(private readonly options: RateLimitOptions) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & RequestWithPrincipal>();
    if (req.path.startsWith('/health')) return true;
    const now = Date.now();
    if (now - this.windowStart >= 60_000) {
      this.windowStart = now;
      this.hits.clear();
    }
    const key = req.user?.sub ?? req.ip ?? 'anonymous';
    const count = (this.hits.get(key) ?? 0) + 1;
    this.hits.set(key, count);
    if (count > this.options.perMinute) {
      const retryAfter = Math.max(1, Math.ceil((this.windowStart + 60_000 - now) / 1000));
      const res = http.getResponse<Response>();
      res.setHeader('Retry-After', String(retryAfter));
      throw new HttpException({ code: 'RATE_LIMITED', params: { seconds: retryAfter } }, 429);
    }
    return true;
  }
}
