import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(7003),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  MONGODB_URI: z.string().min(1),
  RABBITMQ_URL: z.string().min(1),
  JWKS_URL: z.url(),
  JWT_ISSUER: z.string().min(1),
  IDENTITY_URL: z.url().optional(),
  IDEMPOTENCY_TABLE: z.string().min(1).default('bandada-idempotency'),
  DYNAMODB_ENDPOINT: z.string().optional().transform((v) => (v ? v : undefined)),
  AWS_REGION: z.string().default('us-east-1'),
  DEFAULT_LOCALE: z.enum(['es', 'en']).default('es'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001,http://localhost:4201,http://localhost:8081'),
  S3_ENDPOINT: z.url(),
  S3_PUBLIC_ENDPOINT: z.url(),
  S3_BUCKET_MEDIA: z.string().min(1).default('bandada-media'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool.default(true),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(900),
  MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(10_485_760),
  MAX_VIDEO_BYTES: z.coerce.number().int().positive().default(52_428_800),
  MODERATION_MODE: z.enum(['allow-all', 'manual']).default('allow-all'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  OUTBOX_POLL_MS: z.coerce.number().int().min(50).default(500),
  STALE_PROCESSING_MS: z.coerce.number().int().min(1000).default(30_000),
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
