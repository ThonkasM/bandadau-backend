import { createServer, type IncomingMessage, type Server } from 'node:http';

import { Test } from '@nestjs/testing';
import amqplib from 'amqplib';
import { createClient } from 'graphql-ws';
import request from 'supertest';
import WebSocket from 'ws';

import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/bootstrap';
import { loadConfig } from '../../../src/config/env';

export const ISSUER = 'http://api.bandada.localhost';
export const ids = {
  admin: '0192a3b4-0000-7000-8000-00000000a001',
  moderator: '0192a3b4-0000-7000-8000-00000000a002',
  student: '0192a3b4-0000-7000-8000-00000000a003',
  u1: '0192a3b4-0000-7000-8000-000000000011',
  u2: '0192a3b4-0000-7000-8000-000000000012',
  u3: '0192a3b4-0000-7000-8000-000000000013',
  uni: '0192a3b4-0000-7000-8000-0000000000c1',
};

export interface RecordedCall {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  body: unknown;
}

export type MockHandler = (call: RecordedCall) => { status?: number; body?: unknown } | undefined;

export interface Harness {
  gql(query: string, opts?: { token?: string; variables?: Record<string, unknown>; lang?: string }): Promise<request.Response>;
  token(sub: string, roles: string[], extra?: Record<string, unknown>): Promise<string>;
  calls: RecordedCall[];
  callsTo(pathPrefix: string): RecordedCall[];
  mock(method: string, path: string, handler: MockHandler): void;
  resetMocks(): void;
  wsClient(token?: string): ReturnType<typeof createClient>;
  publish(type: string, data: Record<string, unknown>): Promise<void>;
  baseUrl: string;
  close(): Promise<void>;
}

export async function startHarness(overrides: { env?: Record<string, string> } = {}): Promise<Harness> {
  const { exportJWK, generateKeyPair, SignJWT } = await import('jose');
  const rabbitUrl = process.env.IT_RABBITMQ_URL as string;
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'it-rs', alg: 'RS256', use: 'sig' };

  const calls: RecordedCall[] = [];
  const handlers = new Map<string, MockHandler>();
  const mocks: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      const text = Buffer.concat(chunks).toString('utf8');
      const call: RecordedCall = { method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, headers: req.headers, body: text ? JSON.parse(text) : undefined };
      let out: { status?: number; body?: unknown } | undefined;
      if (call.path === '/jwks.json') out = { body: { keys: [jwk] } };
      else if (call.path === '/identity/api/v1/auth/service-token') out = { body: { accessToken: 'svc-token', tokenType: 'Bearer', expiresIn: 300 } };
      else {
        calls.push(call);
        out = handlers.get(`${call.method} ${call.path}`)?.(call);
        if (!out && call.path.endsWith('/health/ready')) out = { body: { status: 'UP', checks: { db: 'UP' } } };
      }
      res.statusCode = out?.status ?? (out ? 200 : 404);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(out?.body ?? { code: 'NOT_FOUND', status: 404 }));
    });
  });
  await new Promise<void>((r) => mocks.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(mocks.address() as { port: number }).port}`;

  const config = loadConfig({
    JWKS_URL: `${base}/jwks.json`,
    JWT_ISSUER: ISSUER,
    IDENTITY_URL: `${base}/identity`,
    SOCIAL_SERVICE_URL: `${base}/social`,
    MEDIA_SERVICE_URL: `${base}/media`,
    EVENTS_SERVICE_URL: `${base}/events`,
    WALLET_SERVICE_URL: `${base}/wallet`,
    TICKETING_SERVICE_URL: `${base}/ticketing`,
    NOTIFICATION_SERVICE_URL: `${base}/notification`,
    SERVICE_CLIENT_SECRET: 'it-secret',
    RABBITMQ_URL: rabbitUrl,
    CORS_ORIGINS: 'http://localhost:3001',
    HTTP_TIMEOUT_MS: '1500',
    INSTANCE_ID: `it${Date.now().toString(36)}`,
    ...overrides.env,
  });

  // The production exchange is created by bandadau-infra; on the private test broker we declare it.
  const conn = await amqplib.connect(rabbitUrl);
  const ch = await conn.createChannel();
  await ch.assertExchange('bandada.events', 'topic', { durable: true });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] }).compile();
  const app = moduleRef.createNestApplication();
  await configureApp(app, config);
  await app.init();
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const sign = (sub: string, roles: string[], extra: Record<string, unknown> = {}) =>
    new SignJWT({ roles, typ: 'user', ...extra })
      .setProtectedHeader({ alg: 'RS256', kid: 'it-rs', typ: 'JWT' })
      .setSubject(sub)
      .setIssuer(ISSUER)
      .setAudience('bandada-admin')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);

  const harness: Harness = {
    baseUrl,
    calls,
    callsTo: (prefix) => calls.filter((c) => c.path.startsWith(prefix)),
    mock: (method, path, handler) => void handlers.set(`${method} ${path}`, handler),
    resetMocks: () => {
      handlers.clear();
      calls.length = 0;
    },
    token: sign,
    async gql(query, opts = {}) {
      const req = request(baseUrl).post('/graphql').set('Content-Type', 'application/json');
      if (opts.token) req.set('Authorization', `Bearer ${opts.token}`);
      if (opts.lang) req.set('Accept-Language', opts.lang);
      return req.send({ query, variables: opts.variables });
    },
    wsClient(token) {
      return createClient({
        url: `ws://127.0.0.1:${port}/graphql`,
        webSocketImpl: WebSocket,
        connectionParams: token ? { Authorization: `Bearer ${token}` } : {},
        retryAttempts: 0,
      });
    },
    async publish(type, data) {
      ch.publish('bandada.events', type, Buffer.from(JSON.stringify({ specversion: '1.0', id: `${Date.now()}`, source: '/services/test', type, time: new Date().toISOString(), datacontenttype: 'application/json', data })), {
        contentType: 'application/cloudevents+json',
      });
    },
    async close() {
      await app.close();
      await new Promise((r) => mocks.close(r));
      await ch.close().catch(() => undefined);
      await conn.close().catch(() => undefined);
    },
  };
  return harness;
}

export const user = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  email: `${id.slice(-4)}@umsa.bo`,
  universityId: ids.uni,
  status: 'ACTIVE',
  roles: ['STUDENT'],
  locale: 'es',
  theme: 'SYSTEM',
  emailVerifiedAt: '2026-10-01T00:00:00Z',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...over,
});
