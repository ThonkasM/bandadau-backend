export interface ServiceUrls {
  identity: string;
  social: string;
  media: string;
  events: string;
  wallet: string;
  ticketing: string;
  notification: string;
  insights: string;
}

export interface GatewayConfig {
  port: number;
  nodeEnv: string;
  jwksUrl: string;
  jwtIssuer: string;
  audience: string[];
  services: ServiceUrls;
  serviceClientId: string;
  serviceClientSecret: string;
  serviceScopes: string[];
  rabbitmqUrl: string;
  rabbitmqManagementUrl: string | undefined;
  rabbitmqManagementUser: string;
  rabbitmqManagementPassword: string;
  maxDepth: number;
  maxComplexity: number;
  introspection: boolean;
  landingPage: boolean;
  corsOrigins: string[];
  httpTimeoutMs: number;
  defaultLocale: 'es' | 'en';
  instanceId: string;
}

type Env = Record<string, string | undefined>;

const required = (env: Env, key: string): string => {
  const v = env[key];
  if (!v) throw new Error(`Missing required env var ${key}`);
  return v;
};
const num = (v: string | undefined, d: number) => {
  if (!v) return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric env value: ${v}`);
  return n;
};
const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(v.toLowerCase()));
const trim = (u: string) => u.replace(/\/+$/, '');

export function loadConfig(env: Env = process.env): GatewayConfig {
  const prod = env.NODE_ENV === 'production';
  return {
    port: num(env.PORT, 7010),
    nodeEnv: env.NODE_ENV ?? 'development',
    jwksUrl: required(env, 'JWKS_URL'),
    jwtIssuer: required(env, 'JWT_ISSUER'),
    audience: (env.JWT_AUDIENCE ?? 'bandada-admin').split(',').map((s) => s.trim()).filter(Boolean),
    services: {
      identity: trim(required(env, 'IDENTITY_URL')),
      social: trim(required(env, 'SOCIAL_SERVICE_URL')),
      media: trim(required(env, 'MEDIA_SERVICE_URL')),
      events: trim(required(env, 'EVENTS_SERVICE_URL')),
      wallet: trim(required(env, 'WALLET_SERVICE_URL')),
      ticketing: trim(required(env, 'TICKETING_SERVICE_URL')),
      notification: trim(env.NOTIFICATION_SERVICE_URL ?? 'http://notification-service:7007'),
      insights: trim(env.INSIGHTS_SERVICE_URL ?? 'http://insights-service:7008'),
    },
    serviceClientId: env.SERVICE_CLIENT_ID ?? 'admin-gateway',
    serviceClientSecret: required(env, 'SERVICE_CLIENT_SECRET'),
    serviceScopes: (env.SERVICE_TOKEN_SCOPES ?? 'internal:read,internal:write').split(',').map((s) => s.trim()).filter(Boolean),
    rabbitmqUrl: required(env, 'RABBITMQ_URL'),
    rabbitmqManagementUrl: env.RABBITMQ_MANAGEMENT_URL ? trim(env.RABBITMQ_MANAGEMENT_URL) : undefined,
    rabbitmqManagementUser: env.RABBITMQ_MANAGEMENT_USER ?? 'monitor',
    rabbitmqManagementPassword: env.RABBITMQ_MANAGEMENT_PASSWORD ?? 'monitor_dev',
    maxDepth: num(env.GRAPHQL_MAX_DEPTH, 7),
    maxComplexity: num(env.GRAPHQL_MAX_COMPLEXITY, 1000),
    introspection: bool(env.GRAPHQL_INTROSPECTION, !prod),
    landingPage: bool(env.GRAPHQL_LANDING_PAGE, !prod),
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
    httpTimeoutMs: num(env.HTTP_TIMEOUT_MS, 3000),
    defaultLocale: env.DEFAULT_LOCALE === 'en' ? 'en' : 'es',
    instanceId: env.INSTANCE_ID ?? `${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  };
}
