import type { RunMonitoringUseCase } from '../../../use-cases/monitoring/run-monitoring';
import type { AppLogger } from '../../../use-cases/ports/misc';

/**
 * In-process cron for the MonitoringAgent: ticks every `tickMs`; the use case takes a lock per 5-minute window
 * (`LOCK#monitoring-window-<yyyyMMddHHmm>` in DynamoDB), so only the first tick of each window (on any replica) runs.
 */
export class MonitoringScheduler {
  private timer?: NodeJS.Timeout;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly monitoring: RunMonitoringUseCase,
    private readonly logger: AppLogger,
    private readonly tickMs = 30_000,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref();
    this.logger.info('monitoring scheduler started', { tickMs: this.tickMs });
  }

  async tick(): Promise<void> {
    try {
      const started = await this.monitoring.start({ trigger: 'SCHEDULE', requestedBy: 'system:monitoring-agent' });
      if (started) {
        this.inFlight = started.done;
        await started.done;
      }
    } catch (error) {
      this.logger.error('monitoring tick failed', { error: (error as Error).message });
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.inFlight.catch(() => undefined);
  }
}
