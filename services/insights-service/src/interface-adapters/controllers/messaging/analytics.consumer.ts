import { type CloudEvent,type DynamoTransaction, type Inbox, MessageConsumer, type MessageContext, type RabbitMqClient } from '@bandada/messaging-ts';

import { activeActor, projectDomainEvent } from '../../../use-cases/metrics/metrics';
import type { AppLogger } from '../../../use-cases/ports/misc';
import type { DynamoMetricRepository } from '../../gateways/dynamo/dynamo-repositories';

export const ANALYTICS_QUEUE = 'insights-service.analytics';

export interface AnalyticsConsumerOptions {
  client: RabbitMqClient;
  inbox: Inbox<DynamoTransaction>;
  metrics: DynamoMetricRepository;
  logger: AppLogger;
  queue?: string;
  topology?: 'verify' | 'declare';
  prefetch?: number;
}

/**
 * Consumes `insights-service.analytics` (binding `bandada.#`): every domain event is projected through the ACL into daily
 * `METRIC#<name>/<date>` counters, inside the inbox transaction (idempotent). The handler map answers for ANY event type, so a
 * new event in the platform is acknowledged (projecting nothing) instead of dead-lettered.
 */
export class AnalyticsConsumer {
  private consumer?: MessageConsumer<DynamoTransaction>;

  constructor(private readonly o: AnalyticsConsumerOptions) {}

  async start(): Promise<void> {
    const handle = async (event: CloudEvent<Record<string, unknown>>, ctx: MessageContext<DynamoTransaction>): Promise<void> => {
      const data = (event.data ?? {}) as Record<string, unknown>;
      const deltas = projectDomainEvent(event.type, data, event.time);
      if (deltas.length > 0) this.o.metrics.stageIncrements(ctx.tx, deltas);
      const actor = activeActor(event.type, data);
      if (actor) await this.o.metrics.stageActiveUser(ctx.tx, event.time.slice(0, 10), actor);
    };
    const handlers = new Proxy({}, { get: (_t, prop) => (typeof prop === 'string' ? handle : undefined) });
    const queue = this.o.queue ?? ANALYTICS_QUEUE;
    this.consumer = new MessageConsumer<DynamoTransaction>({
      client: this.o.client,
      queue,
      handlers: handlers as never,
      inbox: this.o.inbox,
      prefetch: this.o.prefetch ?? 1,
      topology: this.o.topology ?? 'verify',
      ...(this.o.topology === 'declare' ? { bindings: [{ exchange: 'bandada.events', routingKey: 'bandada.#' }] } : {}),
      logger: { debug: () => undefined, info: (m, c) => this.o.logger.info(m, c), warn: (m, c) => this.o.logger.warn(m, c), error: (m, c) => this.o.logger.error(m, c) },
    });
    await this.consumer.start();
    this.o.logger.info('analytics consumer started', { queue });
  }

  async stop(): Promise<void> {
    await this.consumer?.stop();
  }
}
