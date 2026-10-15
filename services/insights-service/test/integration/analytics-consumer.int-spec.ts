import { DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createCloudEvent, DynamoInbox, DynamoOutbox, RabbitMqClient, toAmqpMessage } from '@bandada/messaging-ts';
import amqplib from 'amqplib';

import { AnalyticsConsumer } from '../../src/interface-adapters/controllers/messaging/analytics.consumer';
import { DynamoMetricRepository } from '../../src/interface-adapters/gateways/dynamo/dynamo-repositories';
import { DynamoStore } from '../../src/interface-adapters/gateways/dynamo/dynamo-store';
import { silentLogger } from '../support/fakes';
import { createTables, run } from './support/harness';

const table = `${run}-analytics-insights`;
const idem = `${run}-analytics-idem`;
const queue = `${run}.insights-service.analytics`;
const raw = new DynamoDBClient({ region: 'us-east-1', endpoint: process.env.IT_DYNAMODB_ENDPOINT });
const doc = DynamoDBDocumentClient.from(raw);
const rabbitUrl = process.env.IT_RABBITMQ_URL as string;
let consumer: AnalyticsConsumer;
let client: RabbitMqClient;
let metrics: DynamoMetricRepository;
let conn: amqplib.ChannelModel;
let ch: amqplib.Channel;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => Promise<boolean>, ms = 15_000) {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timeout');
    await sleep(100);
  }
}
const publish = (event: ReturnType<typeof createCloudEvent>) => {
  const { content, options } = toAmqpMessage(event);
  // straight to the private queue (default exchange): never fans out to the live consumers of the platform
  ch.sendToQueue(queue, content, options);
};
const ev = (type: string, data: Record<string, unknown>, id?: string) => createCloudEvent({ type, source: 'it-test', data, time: '2031-03-01T10:00:00Z', ...(id ? { id } : {}) });

beforeAll(async () => {
  await createTables(raw, table, idem);
  const store = new DynamoStore(doc, table, new DynamoOutbox({ client: doc, tableName: table }));
  metrics = new DynamoMetricRepository(store);
  client = new RabbitMqClient({ url: rabbitUrl });
  consumer = new AnalyticsConsumer({ client, inbox: new DynamoInbox({ client: doc, tableName: table }), metrics, logger: silentLogger, queue, topology: 'declare' });
  await consumer.start();
  conn = await amqplib.connect(rabbitUrl);
  ch = await conn.createChannel();
});

afterAll(async () => {
  await consumer.stop();
  for (const q of [queue, `${queue}.retry.5s`, `${queue}.retry.30s`, `${queue}.retry.5m`, `${queue}.dlq`]) await ch.deleteQueue(q).catch(() => undefined);
  await ch.close().catch(() => undefined);
  await conn.close().catch(() => undefined);
  await client.close();
  await raw.send(new DeleteTableCommand({ TableName: table }));
  await raw.send(new DeleteTableCommand({ TableName: idem }));
});

describe('analytics consumer (insights-service.analytics -> METRIC# projection) on a private queue', () => {
  it('projects domain events into daily metrics, idempotently, and acknowledges unknown event types instead of dead-lettering them', async () => {
    const dup = ev('bandada.social.post.created.v1', { authorId: 'author-a' }, '01a13f00-0000-7000-8000-00000000d001');
    publish(ev('bandada.identity.user.registered.v1', { userId: 'new-1' }));
    publish(dup);
    publish(dup); // redelivery of the same message id: counted once (inbox)
    publish(ev('bandada.social.post.created.v1', { authorId: 'author-a' })); // same author, another post
    publish(ev('bandada.events.registration.confirmed.v1', { userId: 'user-b', eventId: 'e' }));
    publish(ev('bandada.wallet.credits-debited.v1', { userId: 'user-b', amountCredits: 20 }));
    publish(ev('bandada.wallet.credits-debited.v1', { userId: 'user-b', amountCredits: 5 }));
    publish(ev('bandada.brand.new-thing.v1', { anything: true })); // no mapping: acked, projects nothing
    await until(async () => (await metrics.series('creditsSpent', '2031-03-01', '2031-03-01'))[0]?.value === 25 && (await metrics.series('registrationsConfirmed', '2031-03-01', '2031-03-01')).length === 1);
    await sleep(300);
    const get = async (n: Parameters<typeof metrics.series>[0]) => (await metrics.series(n, '2031-03-01', '2031-03-01'))[0]?.value;
    expect(await get('newUsers')).toBe(1);
    expect(await get('posts')).toBe(2); // 3 deliveries, 2 distinct messages
    expect(await get('registrationsConfirmed')).toBe(1);
    expect(await get('creditsSpent')).toBe(25);
    expect(await get('activeUsers')).toBe(2); // author-a (2 posts) + user-b, each once per day
    // nothing went to the DLQ, nothing is stuck
    const q = await ch.checkQueue(queue);
    const dlq = await ch.checkQueue(`${queue}.dlq`);
    expect([q.messageCount, dlq.messageCount]).toEqual([0, 0]);
  });

  it('malformed messages are dead-lettered (not retried forever)', async () => {
    ch.sendToQueue(queue, Buffer.from('{"foo":1}'), { contentType: 'application/json' });
    await until(async () => (await ch.checkQueue(`${queue}.dlq`)).messageCount === 1);
    expect((await ch.checkQueue(queue)).messageCount).toBe(0);
  });
});
