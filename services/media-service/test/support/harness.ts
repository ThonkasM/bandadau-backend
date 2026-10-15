import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { uuidv7 } from '@bandada/messaging-ts';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MongoClient } from 'mongodb';

import { AppModule } from '../../src/frameworks-drivers/app.module';
import { loadEnv } from '../../src/frameworks-drivers/config/env';
import { JsonLogger } from '../../src/interface-adapters/logger';

export interface Harness {
  baseUrl: string;
  app: INestApplication;
  db: string;
  userToken(userId: string): Promise<string>;
  serviceToken(): Promise<string>;
  http(method: string, path: string, opts?: { token?: string; body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: any; headers: Headers }>;
  mongo: MongoClient;
  stop(): Promise<void>;
}

const MONGO = process.env.TEST_MONGO_URI ?? 'mongodb://root:mongo_dev@localhost:27017/?authSource=admin&directConnection=true';

/** Boots the real AppModule against live Mongo/DynamoDB with a mock identity (JWKS + service-token) and a mock media-service. */
export async function startHarness(moderationMode: 'allow-all' | 'manual' | 'onnx' = 'allow-all', extraEnv: Record<string, string> = {}): Promise<Harness> {
  const { exportJWK, generateKeyPair, SignJWT } = await import('jose');
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk: Record<string, unknown> = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256', use: 'sig' };
  const sign = (claims: Record<string, unknown>, aud: string, sub: string) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer('http://test-issuer').setAudience(aud).setSubject(sub).setIssuedAt().setExpirationTime('10m').setJti(uuidv7()).sign(privateKey);
  const userToken = (id: string) => sign({ typ: 'user', roles: ['STUDENT'] }, 'bandada-app', id);
  const serviceToken = () => sign({ typ: 'service', scope: 'internal:read internal:write' }, 'bandada-internal', 'admin-gateway');

  let mockUrl = '';
  const mock: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/.well-known/jwks.json') return json(200, { keys: [jwk] });
    return json(404, {});
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
  mockUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

  const db = `media_it_${Date.now().toString(36)}`;
  const env = loadEnv({
    NODE_ENV: 'test',
    PORT: '7999',
    LOG_LEVEL: 'error',
    MONGODB_URI: MONGO.replace('/?', `/${db}?`),
    RABBITMQ_URL: process.env.TEST_RABBITMQ_URL ?? 'amqp://bandada:bandada@localhost:5672',
    JWKS_URL: `${mockUrl}/.well-known/jwks.json`,
    JWT_ISSUER: 'http://test-issuer',
    S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:9000',
    S3_PUBLIC_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:9000',
    S3_ACCESS_KEY_ID: process.env.TEST_S3_KEY ?? 'media-svc',
    S3_SECRET_ACCESS_KEY: process.env.TEST_S3_SECRET ?? 'media_svc_dev_pw',
    MODERATION_MODE: moderationMode,
    STALE_PROCESSING_MS: '60000',
    DYNAMODB_ENDPOINT: process.env.TEST_DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
    AWS_ACCESS_KEY_ID: 'local',
    AWS_SECRET_ACCESS_KEY: 'local',
    MESSAGING_ENABLED: 'false',
    RATE_LIMIT_PER_MINUTE: '100000',
    ...extraEnv,
  } as NodeJS.ProcessEnv);
  process.env.AWS_ACCESS_KEY_ID = 'local';
  process.env.AWS_SECRET_ACCESS_KEY = 'local';

  const app = await NestFactory.create(AppModule.forRoot(env, new JsonLogger('media-test', 'error')), { logger: false });
  await app.listen(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const mongo = new MongoClient(MONGO);
  await mongo.connect();

  return {
    baseUrl,
    app,
    db,
    userToken,
    serviceToken,
    mongo,
    async http(method, path, opts = {}) {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...opts.headers },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
    },
    async stop() {
      await app.close();
      await mongo.db(db).dropDatabase();
      await mongo.close();
      await new Promise<void>((r) => mock.close(() => r()));
    },
  };
}
