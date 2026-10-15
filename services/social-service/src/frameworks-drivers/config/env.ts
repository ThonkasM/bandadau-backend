import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(7002),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  MONGODB_URI: z.string().min(1),
  RABBITMQ_URL: z.string().min(1),
  JWKS_URL: z.url(),
  JWT_ISSUER: z.string().min(1),
  IDENTITY_URL: z.url(),
  SERVICE_CLIENT_ID: z.string().min(1).default('social-service'),
  SERVICE_CLIENT_SECRET: z.string().min(1),
  MEDIA_SERVICE_URL: z.url(),
  MEDIA_HTTP_TIMEOUT_MS: z.coerce.number().int().min(50).max(30_000).default(1500),
  IDEMPOTENCY_TABLE: z.string().min(1).default('bandada-idempotency'),
  DYNAMODB_ENDPOINT: z.string().optional().transform((v) => (v ? v : undefined)),
  AWS_REGION: z.string().default('us-east-1'),
  DEFAULT_LOCALE: z.enum(['es', 'en']).default('es'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001,http://localhost:4201,http://localhost:8081'),
  REPORT_HIDE_THRESHOLD: z.coerce.number().int().min(1).default(3),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  OUTBOX_POLL_MS: z.coerce.number().int().min(50).default(500),
  PENDING_MEDIA_SWEEP_MS: z.coerce.number().int().min(1000).default(60_000),
  MESSAGING_ENABLED: bool.default(true),
});

export type Env = z.output<typeof schema>;

/** Fail fast: throws one readable error listing every invalid or missing variable. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
