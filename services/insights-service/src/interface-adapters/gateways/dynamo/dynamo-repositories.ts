import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { type DynamoTransaction,isConditionalCheckFailed } from '@bandada/messaging-ts';

import type { AgentKind, AgentRun, AgentRunStep } from '../../../entities/agent-run';
import type { Alert, AlertSeverity, AlertStatus } from '../../../entities/alert';
import type { MetricDelta, MetricName, MetricPoint } from '../../../entities/metric-point';
import type { GeneratedReport, ReportStatus } from '../../../entities/report';
import type { OutboundMessage } from '../../../use-cases/ports/misc';
import type { AgentRunRepository, AlertRepository, LockPort, MetricRepository, Page, ReportRepository } from '../../../use-cases/ports/repositories';
import { decodeCursor, type DynamoStore, encodeCursor, nowEpoch, stripKeys, TTL_METRIC_SECONDS, TTL_RUN_SECONDS } from './dynamo-store';

type Item = Record<string, unknown>;
const page = <T>(items: T[], limit: number, sk: (i: T) => string): Page<T> => {
  const slice = items.slice(0, limit);
  return { items: slice, nextCursor: items.length > limit ? encodeCursor(sk(slice[slice.length - 1] as T)) : null };
};

export class DynamoReportRepository implements ReportRepository {
  constructor(private readonly store: DynamoStore) {}

  private toItem(r: GeneratedReport): Item {
    return { pk: `REPORT#${r.id}`, sk: 'META', gsi1pk: 'REPORT', gsi1sk: `${r.createdAt}#${r.id}`, ...r };
  }

  async save(report: GeneratedReport, messages: OutboundMessage[] = []): Promise<void> {
    if (messages.length > 0) await this.store.putWithEvents(this.toItem(report), messages);
    else await this.store.doc.send(new PutCommand({ TableName: this.store.table, Item: this.toItem(report) }));
  }

  async findById(id: string): Promise<GeneratedReport | null> {
    const res = await this.store.doc.send(new GetCommand({ TableName: this.store.table, Key: { pk: `REPORT#${id}`, sk: 'META' }, ConsistentRead: true }));
    return res.Item ? stripKeys<GeneratedReport>(res.Item) : null;
  }

  async list(q: { status?: ReportStatus; cursor?: string; limit: number }): Promise<Page<GeneratedReport>> {
    const items = await this.store.queryNewest<Item>('REPORT', decodeCursor(q.cursor), q.limit, q.status ? (i) => i.status === q.status : undefined);
    const p = page(items, q.limit, (i) => i.gsi1sk as string);
    return { items: p.items.map((i) => stripKeys<GeneratedReport>(i)), nextCursor: p.nextCursor };
  }

  async listUnfinished(): Promise<GeneratedReport[]> {
    const items = await this.store.queryNewest<Item>('REPORT', undefined, 50, (i) => i.status === 'PENDING' || i.status === 'RUNNING');
    return items.slice(0, 50).map((i) => stripKeys<GeneratedReport>(i));
  }
}

export class DynamoAgentRunRepository implements AgentRunRepository {
  constructor(private readonly store: DynamoStore) {}

  private toItem(r: AgentRun): Item {
    return { pk: `AGENTRUN#${r.id}`, sk: 'META', gsi1pk: 'AGENTRUN', gsi1sk: `${r.startedAt}#${r.id}`, expiresAt: nowEpoch() + TTL_RUN_SECONDS, ...r };
  }

  async create(run: AgentRun): Promise<void> {
    await this.store.doc.send(new PutCommand({ TableName: this.store.table, Item: this.toItem(run) }));
  }
  update(run: AgentRun): Promise<void> {
    return this.create(run);
  }

  async appendStep(runId: string, step: AgentRunStep): Promise<void> {
    await this.store.doc.send(
      new PutCommand({
        TableName: this.store.table,
        Item: { pk: `AGENTRUN#${runId}`, sk: `STEP#${String(step.index).padStart(4, '0')}`, expiresAt: nowEpoch() + TTL_RUN_SECONDS, ...step },
      }),
    );
  }

  async findById(id: string): Promise<{ run: AgentRun; steps: AgentRunStep[] } | null> {
    const res = await this.store.doc.send(
      new QueryCommand({ TableName: this.store.table, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': `AGENTRUN#${id}` }, ConsistentRead: true }),
    );
    const items = (res.Items ?? []) as Item[];
    const meta = items.find((i) => i.sk === 'META');
    if (!meta) return null;
    const steps = items.filter((i) => String(i.sk).startsWith('STEP#')).map((i) => stripKeys<AgentRunStep>(i));
    return { run: stripKeys<AgentRun>(meta), steps };
  }

  async list(q: { agent?: AgentKind; cursor?: string; limit: number }): Promise<Page<AgentRun>> {
    const items = await this.store.queryNewest<Item>('AGENTRUN', decodeCursor(q.cursor), q.limit, q.agent ? (i) => i.agent === q.agent : undefined);
    const p = page(items, q.limit, (i) => i.gsi1sk as string);
    return { items: p.items.map((i) => stripKeys<AgentRun>(i)), nextCursor: p.nextCursor };
  }
}

const ACTIVE: AlertStatus[] = ['OPEN', 'ACKNOWLEDGED'];

export class DynamoAlertRepository implements AlertRepository {
  constructor(private readonly store: DynamoStore) {}

  private toItem(a: Alert): Item {
    return { pk: `ALERT#${a.id}`, sk: 'META', gsi1pk: `ALERT#${a.status}`, gsi1sk: `${a.lastSeenAt}#${a.id}`, ...a };
  }

  async save(alert: Alert, messages: OutboundMessage[] = []): Promise<void> {
    if (messages.length > 0) await this.store.putWithEvents(this.toItem(alert), messages);
    else await this.store.doc.send(new PutCommand({ TableName: this.store.table, Item: this.toItem(alert) }));
  }

  async findById(id: string): Promise<Alert | null> {
    const res = await this.store.doc.send(new GetCommand({ TableName: this.store.table, Key: { pk: `ALERT#${id}`, sk: 'META' }, ConsistentRead: true }));
    return res.Item ? stripKeys<Alert>(res.Item) : null;
  }

  async listActive(): Promise<Alert[]> {
    const parts = await Promise.all(ACTIVE.map((s) => this.store.queryNewest<Item>(`ALERT#${s}`, undefined, 200)));
    return parts.flat().map((i) => stripKeys<Alert>(i));
  }

  async findActiveByFingerprint(fingerprint: string): Promise<Alert | null> {
    return (await this.listActive()).find((a) => a.fingerprint === fingerprint) ?? null;
  }

  async countOpen(): Promise<number> {
    return (await this.store.queryNewest<Item>('ALERT#OPEN', undefined, 500)).length;
  }

  async list(q: { status?: AlertStatus; severity?: AlertSeverity; cursor?: string; limit: number }): Promise<Page<Alert>> {
    const cursor = decodeCursor(q.cursor);
    const statuses: AlertStatus[] = q.status ? [q.status] : ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'];
    const filter = q.severity ? (i: Item) => i.severity === q.severity : undefined;
    const parts = await Promise.all(statuses.map((s) => this.store.queryNewest<Item>(`ALERT#${s}`, cursor, q.limit, filter)));
    const merged = parts.flat().sort((a, b) => String(b.gsi1sk).localeCompare(String(a.gsi1sk)));
    const p = page(merged, q.limit, (i) => i.gsi1sk as string);
    return { items: p.items.map((i) => stripKeys<Alert>(i)), nextCursor: p.nextCursor };
  }
}

export class DynamoMetricRepository implements MetricRepository {
  constructor(private readonly store: DynamoStore) {}

  async series(name: MetricName, from: string, to: string): Promise<MetricPoint[]> {
    const res = await this.store.doc.send(
      new QueryCommand({
        TableName: this.store.table,
        KeyConditionExpression: 'pk = :p AND sk BETWEEN :a AND :b',
        ExpressionAttributeValues: { ':p': `METRIC#${name}`, ':a': from, ':b': to },
      }),
    );
    return ((res.Items ?? []) as Item[]).map((i) => ({ name, date: i.sk as string, value: Number(i.value) }));
  }

  async increment(deltas: MetricDelta[]): Promise<void> {
    for (const d of deltas) {
      await this.store.doc.send(
        new UpdateCommand({
          TableName: this.store.table,
          Key: { pk: `METRIC#${d.name}`, sk: d.date },
          UpdateExpression: 'ADD #v :n SET expiresAt = :e',
          ExpressionAttributeNames: { '#v': 'value' },
          ExpressionAttributeValues: { ':n': d.amount, ':e': nowEpoch() + TTL_METRIC_SECONDS },
        }),
      );
    }
  }

  /** Stages the increments (and the per-day active-user marker) inside the inbox transaction of the analytics consumer. */
  stageIncrements(tx: DynamoTransaction, deltas: MetricDelta[]): void {
    for (const d of deltas) {
      tx.update({
        key: { pk: `METRIC#${d.name}`, sk: d.date },
        update: 'ADD #v :n SET expiresAt = :e',
        names: { '#v': 'value' },
        values: { ':n': d.amount, ':e': nowEpoch() + TTL_METRIC_SECONDS },
      });
    }
  }

  /** Counts `actor` once per day towards `activeUsers`. Returns false if already counted (or the marker write raced). */
  async stageActiveUser(tx: DynamoTransaction, date: string, actor: string): Promise<void> {
    const key = { pk: `ACTIVE#${date}`, sk: actor };
    const existing = await this.store.doc.send(new GetCommand({ TableName: this.store.table, Key: key, ConsistentRead: true }));
    if (existing.Item) return;
    tx.put({ ...key, expiresAt: nowEpoch() + 3 * 86_400 }, 'attribute_not_exists(pk)');
    this.stageIncrements(tx, [{ name: 'activeUsers', date, amount: 1 }]);
  }
}

export class DynamoLock implements LockPort {
  constructor(private readonly store: DynamoStore) {}

  async tryAcquire(name: string, ttlMs: number, owner: string): Promise<boolean> {
    const now = Date.now();
    try {
      await this.store.doc.send(
        new PutCommand({
          TableName: this.store.table,
          Item: { pk: `LOCK#${name}`, sk: 'META', owner, leaseUntil: now + ttlMs, expiresAt: Math.floor((now + ttlMs) / 1000) + 600 },
          ConditionExpression: 'attribute_not_exists(pk) OR leaseUntil < :now',
          ExpressionAttributeValues: { ':now': now },
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) return false;
      throw error;
    }
  }

  async holder(name: string): Promise<string | null> {
    const res = await this.store.doc.send(new GetCommand({ TableName: this.store.table, Key: { pk: `LOCK#${name}`, sk: 'META' }, ConsistentRead: true }));
    return res.Item && Number(res.Item.leaseUntil) > Date.now() ? String(res.Item.owner) : null;
  }

  async release(name: string, owner: string): Promise<void> {
    try {
      await this.store.doc.send(
        new DeleteCommand({ TableName: this.store.table, Key: { pk: `LOCK#${name}`, sk: 'META' }, ConditionExpression: '#o = :o', ExpressionAttributeNames: { '#o': 'owner' }, ExpressionAttributeValues: { ':o': owner } }),
      );
    } catch (error) {
      if (!isConditionalCheckFailed(error)) throw error;
    }
  }
}
