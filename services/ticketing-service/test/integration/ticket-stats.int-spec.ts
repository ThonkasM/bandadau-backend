import { createServer, type Server } from 'node:http';

import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { AuthModule } from '@bandada/auth-ts/nest';
import { uuidv7 } from '@bandada/messaging-ts';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';

import { configureApp } from '../../src/frameworks-drivers/bootstrap';
import { InternalStatsController } from '../../src/interface-adapters/controllers/http/internal-stats.controller';
import { ProblemFilter } from '../../src/interface-adapters/controllers/http/problem.filter';
import { DynamoTicketStatsReader } from '../../src/interface-adapters/gateways/dynamo/dynamo-ticket-stats.reader';
import { GetTicketStatsUseCase } from '../../src/use-cases/get-ticket-stats/get-ticket-stats.use-case';

const ISSUER = 'http://api.bandada.localhost';
const table = `${process.env.IT_RUN_ID}-stats`;

let app: INestApplication;
let jwks: Server;
let raw: DynamoDBClient;
let sign: (opts: { typ?: string; aud?: string; scope?: string }) => Promise<string>;

const eventA = uuidv7();
const eventB = uuidv7();

function ticket(eventId: string, title: string, status: string, issuedAt: string) {
  const id = uuidv7();
  return { pk: `TICKET#${id}`, sk: 'META', entity: 'TICKET', ticketId: id, eventId, eventTitle: title, userId: uuidv7(), status, issuedAt };
}

beforeAll(async () => {
  raw = new DynamoDBClient({ region: 'us-east-1', endpoint: process.env.IT_DYNAMODB_ENDPOINT });
  const doc = DynamoDBDocumentClient.from(raw);
  await raw.send(
    new CreateTableCommand({
      TableName: table,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
    }),
  );
  const items = [
    ticket(eventA, 'Hackathon', 'USED', '2026-10-01T00:00:00.000Z'), // first instant of the range
    ticket(eventA, 'Hackathon', 'USED', '2026-10-05T10:00:00.000Z'),
    ticket(eventA, 'Hackathon', 'ISSUED', '2026-10-10T10:00:00.000Z'),
    ticket(eventA, 'Hackathon', 'VOIDED', '2026-10-16T23:59:59.999Z'), // last instant of the range
    ticket(eventB, 'Taller Docker', 'USED', '2026-10-08T12:00:00.000Z'),
    ticket(eventB, 'Taller Docker', 'ISSUED', '2026-10-09T12:00:00.000Z'),
    ticket(eventA, 'Hackathon', 'USED', '2026-09-30T23:59:59.999Z'), // before
    ticket(eventA, 'Hackathon', 'USED', '2026-10-17T00:00:00.000Z'), // after (exclusive)
    { pk: `REG#${uuidv7()}`, sk: 'LOCK', entity: 'REG', eventId: eventA, status: 'USED', issuedAt: '2026-10-05T10:00:00.000Z' }, // not a ticket
  ];
  await doc.send(new BatchWriteCommand({ RequestItems: { [table]: items.map((Item) => ({ PutRequest: { Item } })) } }));

  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'it-rs', alg: 'RS256', use: 'sig' };
  jwks = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((r) => jwks.listen(0, '127.0.0.1', r));
  const port = (jwks.address() as { port: number }).port;
  sign = ({ typ = 'service', aud = 'bandada-internal', scope = 'internal:read' } = {}) =>
    new SignJWT({ typ, scope, roles: [] })
      .setProtectedHeader({ alg: 'RS256', kid: 'it-rs', typ: 'JWT' })
      .setSubject(typ === 'service' ? 'service:insights-service' : uuidv7())
      .setIssuer(ISSUER)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime('10m')
      .setJti(uuidv7())
      .sign(privateKey);

  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule.forRoot({ jwksUrl: `http://127.0.0.1:${port}/jwks.json`, issuer: ISSUER })],
    controllers: [InternalStatsController],
    providers: [
      { provide: APP_FILTER, useClass: ProblemFilter },
      { provide: GetTicketStatsUseCase, useValue: new GetTicketStatsUseCase(new DynamoTicketStatsReader(doc, table)) },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app, { corsOrigins: [] });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await new Promise((r) => jwks?.close(r));
  await raw?.send(new DeleteTableCommand({ TableName: table })).catch(() => undefined);
});

const get = async (query: string, token?: string) => {
  const req = request(app.getHttpServer()).get(`/internal/v1/stats/tickets${query}`);
  return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
};

describe('GET /internal/v1/stats/tickets', () => {
  it('aggregates the issuedAt cohort (inclusive range, tickets only) with byEvent ordering', async () => {
    const res = await get('?from=2026-10-01&to=2026-10-16', await sign({}));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      from: '2026-10-01',
      to: '2026-10-16',
      issued: 6,
      used: 3,
      voided: 1,
      usageRate: 0.5,
      truncated: false,
      byEvent: [
        { eventId: eventA, title: 'Hackathon', issued: 4, used: 2, voided: 1 },
        { eventId: eventB, title: 'Taller Docker', issued: 2, used: 1, voided: 0 },
      ],
    });
  });

  it('filters by eventId and returns zeros for an empty range', async () => {
    const token = await sign({});
    const one = await get(`?from=2026-10-01&to=2026-10-16&eventId=${eventB}`, token);
    expect(one.body).toMatchObject({ issued: 2, used: 1, voided: 0, usageRate: 0.5 });
    expect(one.body.byEvent).toHaveLength(1);
    const empty = await get('?from=2020-01-01&to=2020-01-31', token);
    expect(empty.body).toMatchObject({ issued: 0, usageRate: 0, byEvent: [], truncated: false });
  });

  it('validates input: INVALID_RANGE and VALIDATION_FAILED are 400 problems', async () => {
    const token = await sign({});
    const reversed = await get('?from=2026-10-16&to=2026-10-01', token);
    expect(reversed.status).toBe(400);
    expect(reversed.body.code).toBe('INVALID_RANGE');
    expect(reversed.headers['content-type']).toContain('application/problem+json');
    expect((await get('?from=2025-01-01&to=2026-10-01', token)).body.code).toBe('INVALID_RANGE');
    expect((await get('?from=2026-10-01', token)).body.code).toBe('VALIDATION_FAILED');
    expect((await get('?from=2026-10-01&to=2026-10-02&eventId=nope', token)).body.code).toBe('VALIDATION_FAILED');
  });

  it('requires a service token with internal:read', async () => {
    expect((await get('?from=2026-10-01&to=2026-10-16')).status).toBe(401);
    expect((await get('?from=2026-10-01&to=2026-10-16', await sign({ typ: 'user', aud: 'bandada-app' }))).status).toBe(401);
    expect((await get('?from=2026-10-01&to=2026-10-16', await sign({ aud: 'bandada-app' }))).status).toBe(401);
    expect((await get('?from=2026-10-01&to=2026-10-16', await sign({ scope: 'internal:write' }))).status).toBe(403);
  });
});
