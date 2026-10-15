import { RateLimitedError } from '../../entities/errors/domain-errors';
import type { Clock } from '../ports/misc';

/** Fixed sliding-window counter per key, in memory (per replica; Traefik adds the coarse per-IP limit). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly clock: Clock,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Throws `RateLimitedError` when the key is over its quota. */
  consume(key: string): void {
    const now = this.clock.now().getTime();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      const retry = Math.max(1, Math.ceil((this.windowMs - (now - (recent[0] as number))) / 1000));
      this.hits.set(key, recent);
      throw new RateLimitedError(retry);
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
  }
}
