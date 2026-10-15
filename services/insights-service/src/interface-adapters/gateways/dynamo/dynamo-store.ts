import { type DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { commitTransaction, type DynamoOutbox, DynamoTransaction } from '@bandada/messaging-ts';
import { createCloudEvent } from '@bandada/messaging-ts';

import { InvalidCursorError } from '../../../entities/errors/domain-errors';
import type { OutboundMessage } from '../../../use-cases/ports/misc';

export const SOURCE = 'insights-service';
export const TTL_RUN_SECONDS = 30 * 86_400;
export const TTL_METRIC_SECONDS = 400 * 86_400;

export const encodeCursor = (sk: string): string => Buffer.from(sk, 'utf8').toString('base64url');
export function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  try {
    const sk = Buffer.from(cursor, 'base64url').toString('utf8');
    if (!sk || sk.length > 300 || Buffer.from(sk, 'utf8').toString('base64url') !== cursor) throw new Error('bad');
    return sk;
  } catch {
    throw new InvalidCursorError();
  }
}

export const nowEpoch = () => Math.floor(Date.now() / 1000);

/** Shared plumbing of the Dynamo repositories: one table, GSI1 for listings, outbox items in the same transaction. */
export class DynamoStore {
  constructor(
    readonly doc: DynamoDBDocumentClient,
    readonly table: string,
    private readonly outbox: DynamoOutbox,
  ) {}

  /** Puts `item` and, atomically, the outbox rows for `messages`. */
  async putWithEvents(item: Record<string, unknown>, messages: OutboundMessage[]): Promise<void> {
    const tx = new DynamoTransaction(this.table).put(item);
    await this.stage(tx, messages);
    await commitTransaction(this.doc, tx.items);
  }

  async stage(tx: DynamoTransaction, messages: OutboundMessage[]): Promise<void> {
    for (const m of messages) {
      await this.outbox.enqueue(tx, createCloudEvent({ type: m.type, source: SOURCE, subject: m.subject, data: m.data, correlationid: m.correlationId }));
    }
  }

  /**
   * Newest-first page of a GSI1 partition. `cursor` is the `gsi1sk` of the last item already returned.
   * `filter` is applied in memory over the raw pages until `limit + 1` matches are found (partitions are small).
   */
  async queryNewest<T extends Record<string, unknown>>(pk: string, cursorSk: string | undefined, limit: number, filter?: (i: T) => boolean): Promise<T[]> {
    const out: T[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: 'GSI1',
          KeyConditionExpression: cursorSk ? 'gsi1pk = :p AND gsi1sk < :c' : 'gsi1pk = :p',
          ExpressionAttributeValues: cursorSk ? { ':p': pk, ':c': cursorSk } : { ':p': pk },
          ScanIndexForward: false,
          Limit: Math.max(limit + 1, 25),
          ExclusiveStartKey: lastKey,
        }),
      );
      for (const item of (res.Items ?? []) as T[]) {
        if (!filter || filter(item)) out.push(item);
        if (out.length > limit) return out;
      }
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);
    return out;
  }
}

export const stripKeys = <T>(item: Record<string, unknown>): T => {
  const { pk: _pk, sk: _sk, gsi1pk: _g1, gsi1sk: _g2, expiresAt: _e, ...rest } = item;
  return rest as T;
};
