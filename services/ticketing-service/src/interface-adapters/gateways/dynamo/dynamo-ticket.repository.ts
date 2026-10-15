import { type DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoTransaction, DynamoUnitOfWork } from '@bandada/messaging-ts';

import { ConcurrentTransitionError, InvalidCursorError } from '../../../entities/errors/domain-errors';
import { Ticket, type TicketProps } from '../../../entities/ticket.entity';
import { TicketStatus } from '../../../entities/ticket-status';
import type { OutboundMessage } from '../../../use-cases/ports/event-publisher';
import type {
  ListTicketsQuery,
  RegistrationRecord,
  TicketPage,
  TicketRepository,
} from '../../../use-cases/ports/ticket.repository';
import type { TransactionContext } from '../../../use-cases/ports/transaction';
import type { DynamoOutboxPublisher } from './dynamo-outbox.publisher';

const META = 'META';
const LOCK = 'LOCK';

export const ticketKey = (ticketId: string) => ({ pk: `TICKET#${ticketId}`, sk: META });
export const registrationKey = (registrationId: string) => ({ pk: `REG#${registrationId}`, sk: LOCK });

type Item = Record<string, unknown>;

export function toTicketItem(ticket: Ticket): Item {
  const t = ticket.snapshot();
  return {
    ...ticketKey(t.id),
    entity: 'TICKET',
    ticketId: t.id,
    registrationId: t.registrationId,
    eventId: t.eventId,
    userId: t.userId,
    eventTitle: t.eventTitle,
    eventStartsAt: t.eventStartsAt.toISOString(),
    ...(t.eventEndsAt ? { eventEndsAt: t.eventEndsAt.toISOString() } : {}),
    venue: t.venue,
    ...(t.organizerId ? { organizerId: t.organizerId } : {}),
    staffUserIds: t.staffUserIds,
    status: t.status,
    issuedAt: t.issuedAt.toISOString(),
    gsi1pk: `USER#${t.userId}`,
    gsi1sk: `STARTS#${t.eventStartsAt.toISOString()}#${t.id}`,
    gsi2pk: `REG#${t.registrationId}`,
    gsi2sk: `TICKET#${t.id}`,
  };
}

export function fromTicketItem(item: Item): Ticket {
  const date = (v: unknown) => (typeof v === 'string' ? new Date(v) : null);
  const props: TicketProps = {
    id: item.ticketId as string,
    registrationId: item.registrationId as string,
    eventId: item.eventId as string,
    userId: item.userId as string,
    eventTitle: item.eventTitle as string,
    eventStartsAt: new Date(item.eventStartsAt as string),
    eventEndsAt: date(item.eventEndsAt),
    venue: item.venue as string,
    organizerId: (item.organizerId as string | undefined) ?? null,
    staffUserIds: ((item.staffUserIds as string[] | undefined) ?? []).slice(),
    status: item.status as TicketStatus,
    issuedAt: new Date(item.issuedAt as string),
    usedAt: date(item.usedAt),
    usedBy: (item.usedBy as string | undefined) ?? null,
    voidedAt: date(item.voidedAt),
  };
  return Ticket.restore(props);
}

function isCanceled(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'TransactionCanceledException';
}

export class DynamoTicketRepository implements TicketRepository {
  private readonly uow: DynamoUnitOfWork;

  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly outbox: DynamoOutboxPublisher,
  ) {
    this.uow = new DynamoUnitOfWork(client, tableName);
  }

  async findById(ticketId: string): Promise<Ticket | null> {
    const { Item } = await this.client.send(new GetCommand({ TableName: this.tableName, Key: ticketKey(ticketId), ConsistentRead: true }));
    return Item ? fromTicketItem(Item) : null;
  }

  async findRegistration(registrationId: string): Promise<RegistrationRecord | null> {
    const { Item } = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: registrationKey(registrationId), ConsistentRead: true }),
    );
    if (!Item) return null;
    return {
      registrationId,
      state: Item.state as 'ISSUED' | 'VOIDED',
      ticketId: (Item.ticketId as string | null | undefined) ?? null,
    };
  }

  async listByUser(query: ListTicketsQuery): Promise<TicketPage> {
    const gsi1pk = `USER#${query.userId}`;
    let startKey = this.decodeCursor(query.cursor, gsi1pk);
    const items: Item[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const page = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'gsi1pk = :p',
          ...(query.status ? { FilterExpression: '#s = :s', ExpressionAttributeNames: { '#s': 'status' } } : {}),
          ExpressionAttributeValues: { ':p': gsi1pk, ...(query.status ? { ':s': query.status } : {}) },
          ScanIndexForward: true,
          Limit: query.limit,
          ExclusiveStartKey: startKey,
        }),
      );
      items.push(...((page.Items ?? []) as Item[]));
      lastKey = page.LastEvaluatedKey;
      startKey = lastKey;
    } while (items.length < query.limit && lastKey);

    let nextKey = lastKey;
    if (items.length > query.limit) {
      items.length = query.limit;
      const last = items[query.limit - 1] as Item;
      nextKey = { pk: last.pk, sk: last.sk, gsi1pk: last.gsi1pk, gsi1sk: last.gsi1sk };
    }
    return {
      items: items.map(fromTicketItem),
      nextCursor: nextKey ? Buffer.from(JSON.stringify(nextKey)).toString('base64url') : null,
    };
  }

  create(ticket: Ticket, messages: OutboundMessage[], tx?: TransactionContext): Promise<void> {
    return this.write(tx, async (t) => {
      t.put({ ...registrationKey(ticket.registrationId), entity: 'REGISTRATION', state: 'ISSUED', ticketId: ticket.id, createdAt: ticket.issuedAt.toISOString() }, 'attribute_not_exists(pk)');
      t.put(toTicketItem(ticket), 'attribute_not_exists(pk)');
      await this.outbox.stage(t, messages);
    });
  }

  markUsed(ticket: Ticket, messages: OutboundMessage[], tx?: TransactionContext): Promise<void> {
    return this.write(tx, async (t) => {
      t.update({
        key: ticketKey(ticket.id),
        update: 'SET #s = :used, usedAt = :at, usedBy = :by',
        condition: '#s = :issued AND eventId = :eid',
        names: { '#s': 'status' },
        values: {
          ':used': TicketStatus.USED,
          ':issued': TicketStatus.ISSUED,
          ':at': (ticket.usedAt as Date).toISOString(),
          ':by': ticket.usedBy,
          ':eid': ticket.eventId,
        },
      });
      await this.outbox.stage(t, messages);
    });
  }

  markVoided(ticket: Ticket, messages: OutboundMessage[], tx?: TransactionContext): Promise<void> {
    return this.write(tx, async (t) => {
      t.update({
        key: ticketKey(ticket.id),
        update: 'SET #s = :voided, voidedAt = :at',
        condition: '#s = :issued',
        names: { '#s': 'status' },
        values: { ':voided': TicketStatus.VOIDED, ':issued': TicketStatus.ISSUED, ':at': (ticket.voidedAt as Date).toISOString() },
      });
      t.update({
        key: registrationKey(ticket.registrationId),
        update: 'SET #st = :voided',
        names: { '#st': 'state' },
        values: { ':voided': 'VOIDED' },
      });
      await this.outbox.stage(t, messages);
    });
  }

  recordVoidTombstone(registrationId: string, messages: OutboundMessage[], tx?: TransactionContext): Promise<void> {
    return this.write(tx, async (t) => {
      t.put({ ...registrationKey(registrationId), entity: 'REGISTRATION', state: 'VOIDED', ticketId: null, createdAt: new Date().toISOString() }, 'attribute_not_exists(pk)');
      await this.outbox.stage(t, messages);
    });
  }

  /** Stages into the caller's transaction (inbox) or commits its own. */
  private async write(tx: TransactionContext | undefined, stage: (t: DynamoTransaction) => Promise<void>): Promise<void> {
    if (tx instanceof DynamoTransaction) {
      await stage(tx);
      return;
    }
    try {
      await this.uow.run(stage);
    } catch (error) {
      if (isCanceled(error)) throw new ConcurrentTransitionError();
      throw error;
    }
  }

  private decodeCursor(cursor: string | undefined, gsi1pk: string): Record<string, unknown> | undefined {
    if (!cursor) return undefined;
    try {
      const key = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
      if (key.gsi1pk !== gsi1pk || typeof key.pk !== 'string' || typeof key.sk !== 'string' || typeof key.gsi1sk !== 'string') {
        throw new Error('foreign cursor');
      }
      return { pk: key.pk, sk: key.sk, gsi1pk: key.gsi1pk, gsi1sk: key.gsi1sk };
    } catch {
      throw new InvalidCursorError();
    }
  }
}
