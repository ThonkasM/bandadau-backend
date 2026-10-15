import { createCloudEvent, type MongoOutbox } from '@bandada/messaging-ts';

import type { DomainEvent, EventPublisher } from '../../../use-cases/ports';
import { requestContext } from '../../request-context';
import type { MongoContext } from '../mongo/mongo-context';

/** Writes CloudEvents to the Mongo `outbox` in the ambient transaction; the relay publishes them to RabbitMQ. */
export class OutboxEventPublisher implements EventPublisher {
  constructor(
    private readonly ctx: MongoContext,
    private readonly outbox: MongoOutbox,
    private readonly source: string,
  ) {}

  async publish(event: DomainEvent): Promise<void> {
    const rc = requestContext.get();
    const cloud = createCloudEvent({
      type: event.type,
      source: this.source,
      subject: event.subject,
      data: event.data,
      ...(rc ? { correlationid: rc.correlationId, traceparent: rc.traceparent, ...(rc.causationId ? { causationid: rc.causationId } : {}) } : {}),
    });
    await this.outbox.enqueue(this.ctx.session, cloud);
  }
}
