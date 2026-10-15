import type { AppLogger, JobRunner } from '../../../use-cases/ports/misc';

/** In-process background jobs with bounded concurrency (report generation). */
export class InProcessJobRunner implements JobRunner {
  private readonly queue: { name: string; job: () => Promise<void> }[] = [];
  private running = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly logger: AppLogger,
    private readonly concurrency = 2,
  ) {}

  enqueue(name: string, job: () => Promise<void>): void {
    this.queue.push({ name, job });
    this.pump();
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;
      this.running += 1;
      next
        .job()
        .catch((error: unknown) => this.logger.error('background job failed', { job: next.name, error: (error as Error).message }))
        .finally(() => {
          this.running -= 1;
          this.pump();
          if (this.running === 0 && this.queue.length === 0) for (const w of this.idleWaiters.splice(0)) w();
        });
    }
  }

  /** Resolves when no job is queued or running (tests, graceful shutdown). */
  idle(): Promise<void> {
    return this.running === 0 && this.queue.length === 0 ? Promise.resolve() : new Promise((resolve) => this.idleWaiters.push(resolve));
  }
}
