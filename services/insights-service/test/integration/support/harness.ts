import { createSign, generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ServiceTokenProvider } from '@bandada/auth-ts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { configureApp } from '../../../src/frameworks-drivers/bootstrap';
import { type AppConfig, loadConfig } from '../../../src/frameworks-drivers/config/app-config';
import { AppModule, type AppOverrides } from '../../../src/frameworks-drivers/modules/app.module';
import type { InProcessJobRunner } from '../../../src/interface-adapters/controllers/schedulers/job-runner';
import { LoopbackMcpClientFactory } from '../../../src/interface-adapters/gateways/mcp/loopback-mcp-client';
import { JOB_RUNNER } from '../../../src/use-cases/ports/misc';
import type { PlatformDataPort } from '../../../src/use-cases/ports/platform-data.port';

export const ISSUER = 'http://api.bandada.localhost';
export const run = process.env.IT_RUN_ID as string;
const s = (name: string) => ({ AttributeName: name, AttributeType: 'S' as const });

export const uuid = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

export interface Harness {
  app: INestApplication;
  url: string;
  table: string;
  doc: DynamoDBDocumentClient;
  config: AppConfig;
  token(sub: string, roles: string[], aud?: string): Promise<string>;
  serviceToken(sub?: string): Promise<string>;
  jobsIdle(): Promise<void>;
  outbox(): Promise<Record<string, unknown>[]>;
  s3KeysToClean: string[];
  close(): Promise<void>;
}

export async function createTables(raw: DynamoDBClient, table: string, idem: string): Promise<void> {
  await raw.send(
    new CreateTableCommand({
      TableName: table,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [s('pk'), s('sk'), s('gsi1pk'), s('gsi1sk')],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'gsi1pk', KeyType: 'HASH' },
            { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
  await raw.send(new CreateTableCommand({ TableName: idem, BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [s('pk')], KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }] }));
}

export async function startHarness(options: { overrides?: AppOverrides; platformData?: PlatformDataPort; env?: Record<string, string> } = {}): Promise<Harness> {
  const dynamoEndpoint = process.env.IT_DYNAMODB_ENDPOINT as string;
  const table = `${run}-insights`;
  const idem = `${run}-idempotency`;
  const raw = new DynamoDBClient({ region: 'us-east-1', endpoint: dynamoEndpoint });
  const doc = DynamoDBDocumentClient.from(raw);
  await createTables(raw, table, idem);

  // Identity mock: JWKS + service-token endpoint, RS256 like the real one.
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'it-rs', alg: 'RS256', use: 'sig' };
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const sign = async (claims: Record<string, unknown>, aud: string, ttl = 300): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    const input = `${b64({ alg: 'RS256', kid: 'it-rs', typ: 'JWT' })}.${b64({ ...claims, iss: ISSUER, aud, iat: now, exp: now + ttl })}`;
    return `${input}.${createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url')}`;
  };
  const identity: Server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url?.includes('jwks')) {
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (req.url?.includes('service-token')) {
      void sign({ sub: 'insights-service', typ: 'service', scope: 'internal:read internal:write' }, 'bandada-internal').then((t) => res.end(JSON.stringify({ accessToken: t, tokenType: 'Bearer', expiresIn: 300 })));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((r) => identity.listen(0, '127.0.0.1', r));
  const identityUrl = `http://127.0.0.1:${(identity.address() as AddressInfo).port}`;

  const config = loadConfig({
    PORT: '0',
    NODE_ENV: 'test',
    RABBITMQ_URL: process.env.IT_RABBITMQ_URL,
    JWKS_URL: `${identityUrl}/.well-known/jwks.json`,
    JWT_ISSUER: ISSUER,
    IDENTITY_URL: identityUrl,
    SERVICE_CLIENT_ID: 'insights-service',
    SERVICE_CLIENT_SECRET: 'it',
    DYNAMODB_ENDPOINT: dynamoEndpoint,
    INSIGHTS_TABLE: table,
    IDEMPOTENCY_TABLE: idem,
    S3_ENDPOINT: process.env.IT_S3_ENDPOINT,
    S3_PUBLIC_ENDPOINT: process.env.IT_S3_ENDPOINT,
    S3_ACCESS_KEY_ID: 'insights-svc',
    S3_SECRET_ACCESS_KEY: 'insights_svc_dev_pw',
    S3_BUCKET_AUDIO: 'bandada-reports',
    MONITORING_ENABLED: 'false',
    ...options.env,
  });
  // agents talk to this very app over HTTP (MCP loopback): the port is only known after listen, so the URL is patched in a getter
  const loopbackHolder = { url: '' };
  const mcpClientFactory = options.overrides?.mcpClientFactory ?? {
    create: async (ctx: { actorId?: string; correlationId?: string; agentRunId?: string }) => {
      const tokens = new ServiceTokenProvider({ tokenUrl: `${identityUrl}/api/v1/auth/service-token`, clientId: 'insights-service', clientSecret: 'it' });
      return new LoopbackMcpClientFactory(`${loopbackHolder.url}/mcp`, tokens).create(ctx);
    },
  };

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config, { background: false, platformData: options.platformData, strictMcpOutput: true, mcpClientFactory, ...options.overrides })],
  }).compile();
  const app = moduleRef.createNestApplication({ bodyParser: true });
  configureApp(app, config);
  await app.listen(0, '127.0.0.1');
  loopbackHolder.url = (await app.getUrl()).replace('[::1]', '127.0.0.1');

  const s3 = new S3Client({ region: 'us-east-1', endpoint: process.env.IT_S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: 'insights-svc', secretAccessKey: 'insights_svc_dev_pw' } });
  const keys: string[] = [];
  return {
    app,
    url: loopbackHolder.url,
    table,
    doc,
    config,
    s3KeysToClean: keys,
    token: (sub, roles, aud = 'bandada-admin') => sign({ sub, typ: 'user', roles, scope: '' }, aud),
    serviceToken: (sub = 'insights-service') => sign({ sub, typ: 'service', scope: 'internal:read internal:write' }, 'bandada-internal'),
    jobsIdle: () => (app.get(JOB_RUNNER) as InProcessJobRunner).idle(),
    outbox: async () => {
      const res = await doc.send(new QueryCommand({ TableName: table, IndexName: 'GSI1', KeyConditionExpression: 'gsi1pk = :p', ExpressionAttributeValues: { ':p': 'OUTBOX#PENDING' } }));
      return (res.Items ?? []).map((i) => ({ ...i, payload: JSON.parse(i.payload as string) as unknown }));
    },
    async close() {
      await app.close();
      for (const key of keys) await s3.send(new DeleteObjectCommand({ Bucket: 'bandada-reports', Key: key })).catch(() => undefined);
      await new Promise<void>((r) => identity.close(() => r()));
      await raw.send(new DeleteTableCommand({ TableName: table })).catch(() => undefined);
      await raw.send(new DeleteTableCommand({ TableName: idem })).catch(() => undefined);
    },
  };
}
