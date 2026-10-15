import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createCloudEvent, type DynamoOutbox, DynamoTransaction, DynamoUnitOfWork } from '@bandada/messaging-ts';

import type { EventPublisher, OutboundMessage } from '../../../use-cases/ports/event-publisher';
import type { TransactionContext } from '../../../use-cases/ports/transaction';

const SOURCE = 'ticketing-service';

export class DynamoOutboxPublisher implements EventPublisher {
  private readonly uow: DynamoUnitOfWork;

  constructor(
    client: DynamoDBDocumentClient,
    tableName: string,
    readonly outbox: DynamoOutbox,
  ) {
    this.uow = new DynamoUnitOfWork(client, tableName);
  }

  /** Adds the outbox rows to an open transaction (same `TransactWriteItems` as the business write). */
  async stage(tx: DynamoTransaction, messages: OutboundMessage[]): Promise<void> {
    for (const message of messages) {
      await this.outbox.enqueue(
        tx,
        createCloudEvent({
          type: message.type,
          source: SOURCE,
          subject: message.subject,
          data: message.data,
          correlationid: message.trace.correlationId,
          causationid: message.trace.causationId,
          sagaid: message.trace.sagaId,
          traceparent: message.trace.traceparent,
        }),
      );
    }
  }

  async publish(messages: OutboundMessage[], tx?: TransactionContext): Promise<void> {
    if (tx instanceof DynamoTransaction) {
      await this.stage(tx, messages);
      return;
    }
    await this.uow.run((t) => this.stage(t, messages));
  }
}
