export interface AppConfig {
  port: number;
  nodeEnv: string;
  dynamodbEndpoint: string | undefined;
  awsRegion: string;
  ticketingTable: string;
  idempotencyTable: string;
  rabbitmqUrl: string;
  jwksUrl: string;
  jwtIssuer: string;
  corsOrigins: string[];
  qrSigningKeyPath: string;
  qrSigningKid: string;
  qrPreviousKeysPath: string | undefined;
  chaosTicketingFail: boolean;
  strictOrganizerCheck: boolean;
  validationOpensBeforeMs: number;
  validationDefaultDurationMs: number;
  relayPollIntervalMs: number;
}

type Env = Record<string, string | undefined>;

const bool = (v: string | undefined, fallback: boolean) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes'].includes(v.toLowerCase()));
const num = (v: string | undefined, fallback: number) => {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric env value: ${v}`);
  return n;
};
const required = (env: Env, key: string): string => {
  const value = env[key];
  if (!value) throw new Error(`Missing required env var ${key}`);
  return value;
};

export function loadConfig(env: Env = process.env): AppConfig {
  return {
    port: num(env.PORT, 7006),
    nodeEnv: env.NODE_ENV ?? 'development',
    dynamodbEndpoint: env.DYNAMODB_ENDPOINT || undefined,
    awsRegion: env.AWS_REGION ?? 'us-east-1',
    ticketingTable: env.TICKETING_TABLE ?? 'bandada-ticketing',
    idempotencyTable: env.IDEMPOTENCY_TABLE ?? 'bandada-idempotency',
    rabbitmqUrl: required(env, 'RABBITMQ_URL'),
    jwksUrl: required(env, 'JWKS_URL'),
    jwtIssuer: required(env, 'JWT_ISSUER'),
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
    qrSigningKeyPath: required(env, 'QR_SIGNING_KEY_PATH'),
    qrSigningKid: env.QR_SIGNING_KID ?? 'tk-2026-10',
    qrPreviousKeysPath: env.QR_PREVIOUS_JWKS_PATH || undefined,
    // Read once at startup (demo of the SAGA rollback); never enable in production.
    chaosTicketingFail: bool(env.CHAOS_TICKETING_FAIL, false),
    strictOrganizerCheck: bool(env.STRICT_ORGANIZER_CHECK, false),
    validationOpensBeforeMs: num(env.VALIDATION_OPENS_BEFORE_MINUTES, 120) * 60_000,
    validationDefaultDurationMs: num(env.VALIDATION_DEFAULT_DURATION_MINUTES, 720) * 60_000,
    relayPollIntervalMs: num(env.OUTBOX_RELAY_INTERVAL_MS, 500),
  };
}
