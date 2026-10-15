import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CreateTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { type CloudEvent,createCloudEvent, RabbitMqClient, toAmqpMessage, uuidv7 } from '@bandada/messaging-ts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import amqplib from 'amqplib';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import { configureApp } from '../../../src/frameworks-drivers/bootstrap';
import { loadConfig } from '../../../src/frameworks-drivers/config/app-config';
import { AppModule } from '../../../src/frameworks-drivers/modules/app.module';

export const ISSUER = 'http://api.bandada.localhost';
const run = process.env.IT_RUN_ID as string;
export const COMMANDS_QUEUE = process.env.TICKETING_COMMANDS_QUEUE as string;

export interface Harness {
  app: INestApplication;
  http: Server;
  table: string;
  doc: DynamoDBDocumentClient;
  responses: CloudEvent[];
  token(sub: string, roles: string[]): Promise<string>;
  sendCommand(type: string, data: Record<string, unknown>, opts?: { id?: string }): Promise<CloudEvent>;
  waitFor(predicate: (e: CloudEvent) => boolean, timeoutMs?: number): Promise<CloudEvent>;
  eventsOfType(type: string): CloudEvent[];
  ticketItem(ticketId: string): Promise<Record<string, unknown> | undefined>;
  pendingOutbox(): Promise<number>;
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startHarness(options: { chaos?: boolean; strictOrganizerCheck?: boolean } = {}): Promise<Harness> {
  const dynamoEndpoint = process.env.IT_DYNAMODB_ENDPOINT as string;
  const rabbitUrl = process.env.IT_RABBITMQ_URL as string;
  const table = `${run}-ticketing`;
  const idemTable = `${run}-idempotency`;

  const raw = new DynamoDBClient({ region: 'us-east-1', endpoint: dynamoEndpoint });
  const doc = DynamoDBDocumentClient.from(raw);
  const gsi = (n: number) => ({
    IndexName: `GSI${n}`,
    KeySchema: [
      { AttributeName: `gsi${n}pk`, KeyType: 'HASH' as const },
      { AttributeName: `gsi${n}sk`, KeyType: 'RANGE' as const },
    ],
    Projection: { ProjectionType: 'ALL' as const },
  });
  const s = (name: string) => ({ AttributeName: name, AttributeType: 'S' as const });
  await raw.send(
    new CreateTableCommand({
      TableName: table,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [s('pk'), s('sk'), s('gsi1pk'), s('gsi1sk'), s('gsi2pk'), s('gsi2sk')],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [gsi(1), gsi(2)],
    }),
  );
  await raw.send(
    new CreateTableCommand({
      TableName: idemTable,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [s('pk')],
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
    }),
  );

  // The production topology is created by bandadau-infra; tests declare an equivalent one on a private broker.
  const rabbit = new RabbitMqClient({ url: rabbitUrl });
  await rabbit.declareConsumerTopology({
    queue: COMMANDS_QUEUE,
    bindings: [{ exchange: 'bandada.commands', routingKey: 'bandada.ticketing.cmd.#' }],
  });
  await rabbit.close();
  const conn = await amqplib.connect(rabbitUrl);
  const ch = await conn.createChannel();
  const resultsQueue = `${run}.results`;
  await ch.assertQueue(resultsQueue, { autoDelete: true });
  await ch.bindQueue(resultsQueue, 'bandada.events', 'bandada.ticketing.#');
  const responses: CloudEvent[] = [];
  await ch.consume(resultsQueue, (msg) => {
    if (!msg) return;
    responses.push(JSON.parse(msg.content.toString()) as CloudEvent);
    ch.ack(msg);
  });

  // JWKS mock of identity (RS256).
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'it-rs', alg: 'RS256', use: 'sig' };
  const jwks: Server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((r) => jwks.listen(0, '127.0.0.1', r));
  const jwksPort = (jwks.address() as { port: number }).port;

  const keyDir = mkdtempSync(join(tmpdir(), 'qr-'));
  const keyPath = join(keyDir, 'qr.pem');
  writeFileSync(keyPath, generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'pem', type: 'pkcs8' }));

  const config = loadConfig({
    RABBITMQ_URL: rabbitUrl,
    JWKS_URL: `http://127.0.0.1:${jwksPort}/jwks.json`,
    JWT_ISSUER: ISSUER,
    QR_SIGNING_KEY_PATH: keyPath,
    QR_SIGNING_KID: 'tk-it',
    DYNAMODB_ENDPOINT: dynamoEndpoint,
    TICKETING_TABLE: table,
    IDEMPOTENCY_TABLE: idemTable,
    CHAOS_TICKETING_FAIL: options.chaos ? 'true' : 'false',
    STRICT_ORGANIZER_CHECK: options.strictOrganizerCheck ? 'true' : 'false',
    OUTBOX_RELAY_INTERVAL_MS: '100',
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, config);
  await app.init();

  const publishChannel = await conn.createChannel();
  return {
    app,
    http: app.getHttpServer() as Server,
    table,
    doc,
    responses,
    async token(sub, roles) {
      return new SignJWT({ roles, typ: 'user' })
        .setProtectedHeader({ alg: 'RS256', kid: 'it-rs', typ: 'JWT' })
        .setSubject(sub)
        .setIssuer(ISSUER)
        .setAudience('bandada-app')
        .setIssuedAt()
        .setExpirationTime('10m')
        .setJti(uuidv7())
        .sign(privateKey);
    },
    async sendCommand(type, data, opts = {}) {
      const event = createCloudEvent({
        id: opts.id,
        type,
        source: 'events-service',
        subject: `registrations/${String(data.registrationId)}`,
        data,
        sagaid: data.sagaId as string,
        correlationid: uuidv7(),
      });
      const { content, options: props } = toAmqpMessage(event);
      publishChannel.publish('bandada.commands', type, content, props as never);
      return event;
    },
    async waitFor(predicate, timeoutMs = 15_000) {
      const start = Date.now();
      for (;;) {
        const found = responses.find(predicate);
        if (found) return found;
        if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for message; got ${JSON.stringify(responses.map((r) => r.type))}`);
        await sleep(50);
      }
    },
    eventsOfType: (type) => responses.filter((r) => r.type === type),
    async ticketItem(ticketId) {
      const { Item } = await doc.send(new GetCommand({ TableName: table, Key: { pk: `TICKET#${ticketId}`, sk: 'META' }, ConsistentRead: true }));
      return Item;
    },
    async pendingOutbox() {
      const { Count } = await doc.send(
        new QueryCommand({ TableName: table, IndexName: 'GSI1', KeyConditionExpression: 'gsi1pk = :p', ExpressionAttributeValues: { ':p': 'OUTBOX#PENDING' } }),
      );
      return Count ?? 0;
    },
    async close() {
      await app.close();
      await new Promise((r) => jwks.close(r));
      await publishChannel.close().catch(() => undefined);
      await ch.close().catch(() => undefined);
      await conn.close().catch(() => undefined);
      const cleanup = await amqplib.connect(rabbitUrl);
      const c = await cleanup.createChannel();
      await c.deleteQueue(COMMANDS_QUEUE).catch(() => undefined);
      await cleanup.close();
    },
  };
}

export function issueCommand(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const sagaId = uuidv7();
  return {
    sagaId,
    registrationId: uuidv7(),
    idempotencyKey: `${sagaId}:ISSUE_TICKET`,
    eventId: uuidv7(),
    userId: uuidv7(),
    eventTitle: 'Taller de Docker',
    eventStartsAt: new Date(Date.now() + 3600_000).toISOString(),
    venue: 'Auditorio UMSA',
    deadlineAt: new Date(Date.now() + 30_000).toISOString(),
    ...overrides,
  };
}

export const ISSUE = 'bandada.ticketing.cmd.issue-ticket.v1';
export const VOID = 'bandada.ticketing.cmd.void-ticket.v1';
