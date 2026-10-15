import type { Locale } from '../../entities/locale';
import { DEFAULT_THRESHOLDS, type MonitoringThresholds } from '../../entities/policies/monitoring-rules';

export type LlmProviderName = 'stub' | 'claude' | 'ollama';
export type TtsProviderName = 'none' | 'piper' | 'polly';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  dynamodbEndpoint: string | undefined;
  awsRegion: string;
  insightsTable: string;
  idempotencyTable: string;
  s3Endpoint: string | undefined;
  s3PublicEndpoint: string | undefined;
  s3Bucket: string;
  s3AccessKey: string | undefined;
  s3SecretKey: string | undefined;
  rabbitmqUrl: string;
  rabbitmqManagementUrl: string;
  rabbitmqManagementUser: string;
  rabbitmqManagementPassword: string;
  jwksUrl: string;
  jwtIssuer: string;
  identityUrl: string;
  serviceClientId: string;
  serviceClientSecret: string;
  corsOrigins: string[];
  publicApiUrl: string;
  mcpInternalUrl: string;
  mcpAllowedOrigins: string[];
  mcpServiceClients: string[];
  mcpRequireScope: boolean;
  mcpRateLimitPerMin: number;
  mcpReportsPerHour: number;
  services: Record<string, string>;
  prometheusUrl: string | undefined;
  llmProvider: LlmProviderName;
  anthropicApiKey: string | undefined;
  llmModel: string;
  llmModelCheap: string;
  ollamaUrl: string;
  ollamaModel: string;
  llmPriceInPerM: number;
  llmPriceOutPerM: number;
  ttsProvider: TtsProviderName;
  piperUrl: string;
  piperVoiceEs: string;
  piperVoiceEn: string;
  pollyVoiceEs: string;
  pollyVoiceEn: string;
  agentMaxSteps: number;
  agentMaxTokens: number;
  monitoringEnabled: boolean;
  monitoringIntervalMs: number;
  monitoringExplain: boolean;
  anomalyMetrics: string[];
  anomalyDays: number;
  anomalySensitivity: number;
  thresholds: MonitoringThresholds;
  analyticsEnabled: boolean;
  relayPollIntervalMs: number;
  defaultLocale: Locale;
}

type Env = Record<string, string | undefined>;
const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(v.toLowerCase()));
const num = (v: string | undefined, d: number) => {
  if (v === undefined || v === '') return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric env value: ${v}`);
  return n;
};
const required = (env: Env, key: string): string => {
  const v = env[key];
  if (!v) throw new Error(`Missing required env var ${key}`);
  return v;
};
const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[], d: T, key: string): T => {
  if (v === undefined || v === '') return d;
  if (!(allowed as readonly string[]).includes(v)) throw new Error(`${key} must be one of ${allowed.join(', ')}`);
  return v as T;
};

export function loadConfig(env: Env = process.env): AppConfig {
  const port = num(env.PORT, 7008);
  const locale = oneOf(env.DEFAULT_LOCALE, ['es', 'en'] as const, 'es', 'DEFAULT_LOCALE');
  return {
    port,
    nodeEnv: env.NODE_ENV ?? 'development',
    dynamodbEndpoint: env.DYNAMODB_ENDPOINT || undefined,
    awsRegion: env.AWS_REGION ?? 'us-east-1',
    insightsTable: env.INSIGHTS_TABLE ?? 'bandada-insights',
    idempotencyTable: env.IDEMPOTENCY_TABLE ?? 'bandada-idempotency',
    s3Endpoint: env.S3_ENDPOINT || undefined,
    s3PublicEndpoint: env.S3_PUBLIC_ENDPOINT || env.S3_ENDPOINT || undefined,
    s3Bucket: env.S3_BUCKET_AUDIO ?? env.S3_BUCKET_REPORTS ?? 'bandada-reports',
    s3AccessKey: env.S3_ACCESS_KEY_ID || undefined,
    s3SecretKey: env.S3_SECRET_ACCESS_KEY || undefined,
    rabbitmqUrl: required(env, 'RABBITMQ_URL'),
    rabbitmqManagementUrl: env.RABBITMQ_MANAGEMENT_URL ?? 'http://localhost:15672',
    rabbitmqManagementUser: env.RABBITMQ_MANAGEMENT_USER ?? 'monitor',
    rabbitmqManagementPassword: env.RABBITMQ_MANAGEMENT_PASSWORD ?? 'monitor_dev',
    jwksUrl: required(env, 'JWKS_URL'),
    jwtIssuer: required(env, 'JWT_ISSUER'),
    identityUrl: required(env, 'IDENTITY_URL'),
    serviceClientId: env.SERVICE_CLIENT_ID ?? 'insights-service',
    serviceClientSecret: required(env, 'SERVICE_CLIENT_SECRET'),
    corsOrigins: list(env.CORS_ORIGINS),
    publicApiUrl: env.PUBLIC_API_URL ?? 'http://api.bandada.localhost',
    mcpInternalUrl: env.MCP_INTERNAL_URL ?? `http://127.0.0.1:${port}/mcp`,
    mcpAllowedOrigins: list(env.MCP_ALLOWED_ORIGINS),
    mcpServiceClients: list(env.MCP_SERVICE_CLIENTS ?? 'insights-service'),
    mcpRequireScope: bool(env.MCP_REQUIRE_SCOPE, false),
    mcpRateLimitPerMin: num(env.MCP_RATE_LIMIT_PER_MIN, 30),
    mcpReportsPerHour: num(env.MCP_REPORTS_PER_HOUR, 10),
    services: {
      'identity-service': env.IDENTITY_URL ?? 'http://localhost:7001',
      'social-service': env.SOCIAL_SERVICE_URL ?? 'http://localhost:7002',
      'media-service': env.MEDIA_SERVICE_URL ?? 'http://localhost:7003',
      'events-service': env.EVENTS_SERVICE_URL ?? 'http://localhost:7004',
      'wallet-service': env.WALLET_SERVICE_URL ?? 'http://localhost:7005',
      'ticketing-service': env.TICKETING_SERVICE_URL ?? 'http://localhost:7006',
      'notification-service': env.NOTIFICATION_SERVICE_URL ?? 'http://localhost:7007',
      'insights-service': `http://127.0.0.1:${port}`,
      'admin-gateway': env.ADMIN_GATEWAY_URL ?? 'http://localhost:7010',
    },
    prometheusUrl: env.PROMETHEUS_URL || undefined,
    llmProvider: oneOf(env.LLM_PROVIDER, ['stub', 'claude', 'ollama'] as const, 'stub', 'LLM_PROVIDER'),
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    llmModel: env.LLM_MODEL ?? 'claude-sonnet-5-5',
    llmModelCheap: env.LLM_MODEL_CHEAP ?? 'claude-haiku-5-5',
    ollamaUrl: env.OLLAMA_URL ?? 'http://localhost:11434',
    ollamaModel: env.OLLAMA_MODEL ?? 'llama3.2',
    llmPriceInPerM: num(env.LLM_PRICE_IN_PER_M, 2),
    llmPriceOutPerM: num(env.LLM_PRICE_OUT_PER_M, 10),
    ttsProvider: oneOf(env.TTS_PROVIDER, ['none', 'piper', 'polly'] as const, 'none', 'TTS_PROVIDER'),
    piperUrl: env.PIPER_URL ?? 'http://localhost:5002',
    piperVoiceEs: env.TTS_VOICE_ES ?? 'es_MX-claude-high',
    piperVoiceEn: env.TTS_VOICE_EN ?? 'en_US-lessac-medium',
    pollyVoiceEs: env.POLLY_VOICE_ES ?? 'Mia',
    pollyVoiceEn: env.POLLY_VOICE_EN ?? 'Joanna',
    agentMaxSteps: num(env.AGENT_MAX_STEPS, 8),
    agentMaxTokens: num(env.AGENT_MAX_TOKENS, 20_000),
    monitoringEnabled: bool(env.MONITORING_ENABLED, true),
    monitoringIntervalMs: num(env.MONITORING_INTERVAL_SECONDS, 300) * 1000,
    monitoringExplain: bool(env.MONITORING_EXPLAIN, true),
    anomalyMetrics: list(env.ANOMALY_METRICS ?? 'registrationsConfirmed,registrationsFailed,posts,creditsSpent,sagaCompensations'),
    anomalyDays: num(env.ANOMALY_DAYS, 30),
    anomalySensitivity: num(env.ANOMALY_SENSITIVITY, 0.8),
    thresholds: {
      ...DEFAULT_THRESHOLDS,
      dlqCritical: num(env.MONITORING_DLQ_CRITICAL, DEFAULT_THRESHOLDS.dlqCritical),
      queueBacklog: num(env.MONITORING_QUEUE_BACKLOG, DEFAULT_THRESHOLDS.queueBacklog),
      sagaFailedCritical: num(env.MONITORING_SAGA_FAILED_CRITICAL, DEFAULT_THRESHOLDS.sagaFailedCritical),
      sagaCompensatedWarning: num(env.MONITORING_SAGA_COMPENSATED_WARNING, DEFAULT_THRESHOLDS.sagaCompensatedWarning),
      moderationPending: num(env.MONITORING_MODERATION_PENDING, DEFAULT_THRESHOLDS.moderationPending),
    },
    analyticsEnabled: bool(env.ANALYTICS_CONSUMER_ENABLED, true),
    relayPollIntervalMs: num(env.OUTBOX_RELAY_INTERVAL_MS, 500),
    defaultLocale: locale,
  };
}
