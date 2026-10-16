/** Simple circuit breaker: `threshold` consecutive failures open it for `openMs`; afterwards one probe is allowed (half-open). */
export class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;

  constructor(
    private readonly threshold = 3,
    private readonly openMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  get isOpen(): boolean {
    return this.failures >= this.threshold && this.now() < this.openUntil;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openUntil = 0;
  }

  recordFailure(coolDownMs?: number): void {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openUntil = this.now() + (coolDownMs ?? this.openMs);
  }

  /** Opens it right away (e.g. 429 with a Retry-After): no point in trying again before that. */
  trip(coolDownMs: number): void {
    this.failures = this.threshold;
    this.openUntil = this.now() + coolDownMs;
  }
}
