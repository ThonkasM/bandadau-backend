import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ServiceTokenProvider } from '@bandada/auth-ts';
import { AuthModule, JwtAuthGuard, RolesGuard } from '@bandada/auth-ts/nest';
import { IdempotencyModule } from '@bandada/idempotency-ts/nest';
import { DynamoInbox, DynamoOutbox, type RabbitMqClient, uuidv7 } from '@bandada/messaging-ts';
import { MessagingModule } from '@bandada/messaging-ts/nest';
import { RABBIT_CLIENT } from '@bandada/messaging-ts/nest';
import { type DynamicModule, Inject, Injectable, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { ProblemFilter } from '../../interface-adapters/controllers/http/problem.filter';
import { InsightsController, InternalController } from '../../interface-adapters/controllers/http/reports-alerts.controllers';
import { MCP_ALLOWED_ORIGINS, McpController } from '../../interface-adapters/controllers/mcp/mcp.controller';
import { McpServerFactory } from '../../interface-adapters/controllers/mcp/mcp-server.factory';
import { AnalyticsConsumer } from '../../interface-adapters/controllers/messaging/analytics.consumer';
import { InProcessJobRunner } from '../../interface-adapters/controllers/schedulers/job-runner';
import { MonitoringScheduler } from '../../interface-adapters/controllers/schedulers/monitoring.scheduler';
import { StatAnomalyDetector } from '../../interface-adapters/gateways/anomaly/stat-anomaly.detector';
import { DynamoAgentRunRepository, DynamoAlertRepository, DynamoLock, DynamoMetricRepository, DynamoReportRepository } from '../../interface-adapters/gateways/dynamo/dynamo-repositories';
import { DynamoStore } from '../../interface-adapters/gateways/dynamo/dynamo-store';
import { PlatformDataGateway } from '../../interface-adapters/gateways/internal-api/platform-data.gateway';
import { AnthropicAdapter } from '../../interface-adapters/gateways/llm/anthropic.adapter';
import { FallbackLlmAdapter } from '../../interface-adapters/gateways/llm/fallback.adapter';
import { OllamaAdapter } from '../../interface-adapters/gateways/llm/ollama.adapter';
import { OllamaHybridAdapter } from '../../interface-adapters/gateways/llm/ollama-hybrid.adapter';
import { StubLlmAdapter } from '../../interface-adapters/gateways/llm/stub.adapter';
import { LoopbackMcpClientFactory } from '../../interface-adapters/gateways/mcp/loopback-mcp-client';
import { S3AudioStorage } from '../../interface-adapters/gateways/s3/s3-audio.storage';
import { McpAuthenticator } from '../../interface-adapters/gateways/security/mcp-auth';
import { IdentityMcpTokenStatus, type McpTokenStatusChecker } from '../../interface-adapters/gateways/security/mcp-token-status';
import { NullTts, PiperTts, PollyTts } from '../../interface-adapters/gateways/tts/tts.adapters';
import { McpToolService } from '../../use-cases/mcp-tools/mcp-tools';
import { RateLimiter } from '../../use-cases/mcp-tools/rate-limiter';
import { DetectAnomaliesUseCase,GetPlatformKpisUseCase } from '../../use-cases/metrics/metrics';
import { AcknowledgeAlertUseCase, ListAlertsUseCase, RaiseAlertUseCase } from '../../use-cases/monitoring/alerts';
import { RunMonitoringUseCase } from '../../use-cases/monitoring/run-monitoring';
import { LLM_PORT, type LlmPort, type LlmPricing } from '../../use-cases/ports/llm.port';
import { MCP_CLIENT_FACTORY, type McpClientFactory } from '../../use-cases/ports/mcp-client.port';
import { ANOMALY_DETECTOR, APP_LOGGER, type AppLogger, AUDIO_STORAGE, type AudioStorage, CLOCK, type Clock, ID_GENERATOR, JOB_RUNNER, PROMPT_CATALOG } from '../../use-cases/ports/misc';
import { PLATFORM_DATA, type PlatformDataPort } from '../../use-cases/ports/platform-data.port';
import { AGENT_RUN_REPOSITORY, ALERT_REPOSITORY, LOCK_PORT, METRIC_REPOSITORY, REPORT_REPOSITORY } from '../../use-cases/ports/repositories';
import { TTS_PORT, type TtsPort } from '../../use-cases/ports/tts.port';
import { GenerateReportUseCase } from '../../use-cases/reports/generate-report';
import { GetReportUseCase, ListReportsUseCase } from '../../use-cases/reports/get-report';
import { ReportFinalizer } from '../../use-cases/reports/report-finalizer';
import { RequestReportUseCase } from '../../use-cases/reports/request-report';
import { SaveExternalReportUseCase } from '../../use-cases/reports/save-external-report';
import type { AppConfig } from '../config/app-config';
import { HealthController } from '../health/health.controller';
import { JsonLogger } from '../observability/json-logger';
import { promptCatalog } from '../prompts/prompts';
import { APP_CONFIG, DYNAMO_CLIENT, DYNAMO_DOC, INSIGHTS_TABLE } from './tokens';

export interface AppOverrides {
  logger?: AppLogger;
  clock?: Clock;
  llm?: LlmPort;
  tts?: TtsPort;
  storage?: AudioStorage;
  platformData?: PlatformDataPort;
  mcpClientFactory?: McpClientFactory;
  mcpTokenStatus?: McpTokenStatusChecker;
  /** false: no RabbitMQ (outbox rows stay pending), no consumer, no scheduler (unit/e2e tests). */
  background?: boolean;
  analyticsQueue?: string;
  analyticsTopology?: 'verify' | 'declare';
  strictMcpOutput?: boolean;
}

const MONITOR_RUN_STALE_MS = 3 * 60_000;

export function buildLlm(config: AppConfig, logger: AppLogger): { llm: LlmPort; pricing: LlmPricing } {
  if (config.llmProvider === 'claude') {
    const adapter = new AnthropicAdapter({ apiKey: config.anthropicApiKey, model: config.llmModel, modelCheap: config.llmModelCheap });
    if (adapter.enabled) return { llm: config.llmFallback === 'stub' ? new FallbackLlmAdapter(adapter, new StubLlmAdapter()) : adapter, pricing: { inPerM: config.llmPriceInPerM, outPerM: config.llmPriceOutPerM } };
    logger.warn('LLM_PROVIDER=claude but ANTHROPIC_API_KEY is not set: Anthropic adapter disabled, using the deterministic stub');
  } else if (config.llmProvider === 'ollama') {
    const ollama = new OllamaAdapter({ url: config.ollamaUrl, model: config.ollamaModel, timeoutMs: config.ollamaTimeoutMs });
    // small local model: deterministic planner + verified answer wording (ollama-hybrid.adapter.ts); fallback `stub` unless LLM_FALLBACK=none
    const fallback = config.llmFallbackExplicit ? config.llmFallback : 'stub';
    return { llm: new OllamaHybridAdapter({ ollama, fallback, model: config.ollamaModel }), pricing: { inPerM: 0, outPerM: 0 } };
  }
  return { llm: new StubLlmAdapter(), pricing: { inPerM: 0, outPerM: 0 } };
}

export function buildTts(config: AppConfig, logger: AppLogger): TtsPort {
  if (config.ttsProvider === 'piper') return new PiperTts({ url: config.piperUrl, voiceEs: config.piperVoiceEs, voiceEn: config.piperVoiceEn });
  if (config.ttsProvider === 'polly') {
    const key = process.env.AWS_ACCESS_KEY_ID;
    const enabled = process.env.POLLY_ENABLED === 'true' || (Boolean(key) && key !== 'local');
    if (!enabled) logger.warn('TTS_PROVIDER=polly without real AWS credentials: Polly disabled, reports will have no audio');
    return new PollyTts({ region: config.awsRegion, voiceEs: config.pollyVoiceEs, voiceEn: config.pollyVoiceEn, enabled });
  }
  return new NullTts();
}

const INSIGHTS_REPORTS = Symbol('RECOVER_REPORTS');

@Injectable()
class Lifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(AnalyticsConsumer) private readonly consumer: AnalyticsConsumer | null,
    @Inject(MonitoringScheduler) private readonly scheduler: MonitoringScheduler | null,
    @Inject(INSIGHTS_REPORTS) private readonly recover: () => Promise<void>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.recover();
    await this.consumer?.start();
    this.scheduler?.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.scheduler?.stop();
    await this.consumer?.stop();
  }
}
@Module({})
export class AppModule {
  static forRoot(config: AppConfig, overrides: AppOverrides = {}): DynamicModule {
    const logger: AppLogger = overrides.logger ?? new JsonLogger();
    const background = overrides.background !== false;
    const dynamo = new DynamoDBClient({ region: config.awsRegion, ...(config.dynamodbEndpoint ? { endpoint: config.dynamodbEndpoint } : {}) });
    const doc = DynamoDBDocumentClient.from(dynamo, { marshallOptions: { removeUndefinedValues: true } });
    const outbox = new DynamoOutbox({ client: doc, tableName: config.insightsTable });
    const inbox = new DynamoInbox({ client: doc, tableName: config.insightsTable });
    const store = new DynamoStore(doc, config.insightsTable, outbox);
    const tokens = new ServiceTokenProvider({
      tokenUrl: `${config.identityUrl}/api/v1/auth/service-token`,
      clientId: config.serviceClientId,
      clientSecret: config.serviceClientSecret,
      scopes: ['internal:read', 'internal:write'],
    });
    const { llm, pricing } = overrides.llm ? { llm: overrides.llm, pricing: { inPerM: 0, outPerM: 0 } } : buildLlm(config, logger);
    const tts = overrides.tts ?? buildTts(config, logger);
    const clock: Clock = overrides.clock ?? { now: () => new Date() };
    const ids = { next: () => uuidv7() };

    const reports = new DynamoReportRepository(store);
    const runs = new DynamoAgentRunRepository(store);
    const alerts = new DynamoAlertRepository(store);
    const metrics = new DynamoMetricRepository(store);
    const locks = new DynamoLock(store);
    const storage =
      overrides.storage ??
      new S3AudioStorage({ bucket: config.s3Bucket, region: config.awsRegion, endpoint: config.s3Endpoint, publicEndpoint: config.s3PublicEndpoint, accessKeyId: config.s3AccessKey, secretAccessKey: config.s3SecretKey });
    const platformData =
      overrides.platformData ??
      new PlatformDataGateway({
        services: config.services,
        tokens,
        rabbit: { url: config.rabbitmqManagementUrl, user: config.rabbitmqManagementUser, password: config.rabbitmqManagementPassword },
        prometheusUrl: config.prometheusUrl,
      });
    const mcpClients = overrides.mcpClientFactory ?? new LoopbackMcpClientFactory(config.mcpInternalUrl, tokens);
    const jobs = new InProcessJobRunner(logger);
    const detector = new StatAnomalyDetector();

    const finalizer = new ReportFinalizer(reports, tts, storage, clock, logger);
    const generate = new GenerateReportUseCase(llm, mcpClients, reports, runs, finalizer, promptCatalog, clock, logger, pricing, { maxSteps: config.agentMaxSteps, maxTokens: config.agentMaxTokens });
    const requestReport = new RequestReportUseCase(reports, runs, clock, ids, jobs, promptCatalog, logger, (id) => generate.execute(id));
    const raiseAlert = new RaiseAlertUseCase(alerts, clock, ids);
    const kpis = new GetPlatformKpisUseCase(metrics, alerts);
    const anomalies = new DetectAnomaliesUseCase(metrics, detector);
    const saveExternal = new SaveExternalReportUseCase(reports, finalizer, tts, clock, ids, jobs, config.defaultLocale, config.publicApiUrl);
    const toolService = new McpToolService(platformData, kpis, anomalies, raiseAlert, saveExternal);
    const monitoring = new RunMonitoringUseCase(mcpClients, runs, alerts, locks, llm, promptCatalog, clock, ids, logger, {
      thresholds: config.thresholds,
      anomalyMetrics: config.anomalyMetrics,
      anomalyDays: config.anomalyDays,
      anomalySensitivity: config.anomalySensitivity,
      explain: config.monitoringExplain,
    });
    const mcpFactory = new McpServerFactory({
      tools: toolService,
      kpis,
      alerts,
      runs,
      clock,
      ids,
      logger,
      callLimiter: new RateLimiter(clock, config.mcpRateLimitPerMin, 60_000),
      serviceCallLimiter: new RateLimiter(clock, config.mcpRateLimitPerMin * 4, 60_000),
      reportLimiter: new RateLimiter(clock, config.mcpReportsPerHour, 3_600_000),
      strictOutput: overrides.strictMcpOutput ?? config.nodeEnv !== 'production',
    });
    const mcpAuth = new McpAuthenticator({ jwksUrl: config.jwksUrl, issuer: config.jwtIssuer, serviceClients: config.mcpServiceClients, requireServiceScope: config.mcpRequireScope, tokenStatus: overrides.mcpTokenStatus ?? new IdentityMcpTokenStatus({ identityUrl: config.identityUrl, tokens }) });
    const allowedOrigins = [...new Set([...config.mcpAllowedOrigins, ...config.corsOrigins, 'http://localhost:6274', 'http://127.0.0.1:6274'])];

    const recoverUnfinished = async () => {
      // A report left PENDING/RUNNING by a previous process can never finish: mark it FAILED so clients stop polling.
      for (const r of await reports.listUnfinished()) {
        if (clock.now().getTime() - Date.parse(r.createdAt) > MONITOR_RUN_STALE_MS) await finalizer.fail(r, 'INTERRUPTED');
      }
    };

    const imports: NonNullable<DynamicModule['imports']> = [
      AuthModule.forRoot({ jwksUrl: config.jwksUrl, issuer: config.jwtIssuer }),
      IdempotencyModule.forRoot({ service: 'insights', client: doc, tableName: config.idempotencyTable }),
    ];
    if (background) {
      imports.push(
        MessagingModule.forRoot({
          rabbit: { url: config.rabbitmqUrl },
          relay: { outbox, pollIntervalMs: config.relayPollIntervalMs },
          logger: { debug: () => undefined, info: (m, c) => logger.info(m, c), warn: (m, c) => logger.warn(m, c), error: (m, c) => logger.error(m, c) },
        }),
      );
    }

    return {
      module: AppModule,
      imports,
      controllers: [InsightsController, InternalController, McpController, HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: DYNAMO_CLIENT, useValue: dynamo },
        { provide: DYNAMO_DOC, useValue: doc },
        { provide: INSIGHTS_TABLE, useValue: config.insightsTable },
        { provide: APP_GUARD, useExisting: JwtAuthGuard },
        { provide: APP_GUARD, useExisting: RolesGuard },
        { provide: APP_FILTER, useClass: ProblemFilter },
        { provide: APP_LOGGER, useValue: logger },
        { provide: CLOCK, useValue: clock },
        { provide: ID_GENERATOR, useValue: ids },
        { provide: LLM_PORT, useValue: llm },
        { provide: TTS_PORT, useValue: tts },
        { provide: AUDIO_STORAGE, useValue: storage },
        { provide: PLATFORM_DATA, useValue: platformData },
        { provide: MCP_CLIENT_FACTORY, useValue: mcpClients },
        { provide: JOB_RUNNER, useValue: jobs },
        { provide: ANOMALY_DETECTOR, useValue: detector },
        { provide: PROMPT_CATALOG, useValue: promptCatalog },
        { provide: REPORT_REPOSITORY, useValue: reports },
        { provide: AGENT_RUN_REPOSITORY, useValue: runs },
        { provide: ALERT_REPOSITORY, useValue: alerts },
        { provide: METRIC_REPOSITORY, useValue: metrics },
        { provide: LOCK_PORT, useValue: locks },
        { provide: RequestReportUseCase, useValue: requestReport },
        { provide: GetReportUseCase, useValue: new GetReportUseCase(reports, storage) },
        { provide: ListReportsUseCase, useValue: new ListReportsUseCase(reports) },
        { provide: GenerateReportUseCase, useValue: generate },
        { provide: RaiseAlertUseCase, useValue: raiseAlert },
        { provide: AcknowledgeAlertUseCase, useValue: new AcknowledgeAlertUseCase(alerts, clock) },
        { provide: ListAlertsUseCase, useValue: new ListAlertsUseCase(alerts) },
        { provide: RunMonitoringUseCase, useValue: monitoring },
        { provide: GetPlatformKpisUseCase, useValue: kpis },
        { provide: McpServerFactory, useValue: mcpFactory },
        { provide: McpAuthenticator, useValue: mcpAuth },
        { provide: MCP_ALLOWED_ORIGINS, useValue: allowedOrigins },
        { provide: INSIGHTS_REPORTS, useValue: recoverUnfinished },
        {
          provide: AnalyticsConsumer,
          inject: background && config.analyticsEnabled ? [RABBIT_CLIENT] : [],
          useFactory: (client?: RabbitMqClient) =>
            client
              ? new AnalyticsConsumer({ client, inbox, metrics, logger, queue: overrides.analyticsQueue, topology: overrides.analyticsTopology })
              : null,
        },
        { provide: MonitoringScheduler, useValue: background && config.monitoringEnabled ? new MonitoringScheduler(monitoring, logger) : null },
        Lifecycle,
      ],
      exports: [JOB_RUNNER],
    };
  }
}
