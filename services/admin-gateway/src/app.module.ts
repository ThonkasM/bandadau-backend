import { ServiceTokenProvider } from '@bandada/auth-ts';
import { Controller, type DynamicModule, Get, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';

import { ServiceHttp } from './common/http-client';
import type { GatewayConfig } from './config/env';
import { DATA_SOURCES, type DataSources, EventsClient, IdentityClient, InsightsClient, MediaClient, SocialClient, WalletClient } from './data-sources/data-sources';
import { GraphqlServer } from './graphql/graphql-server';
import { RabbitEventBus } from './graphql/pubsub/rabbit-event-bus';
import { dashboardResolvers } from './modules/dashboard/dashboard.resolvers';
import { DashboardService } from './modules/dashboard/dashboard.service';
import { disabledResolvers } from './modules/disabled/disabled.resolvers';
import { eventsResolvers } from './modules/events/events.resolvers';
import { EventsService } from './modules/events/events.service';
import { ServiceHealthService } from './modules/health/service-health.service';
import { usersResolvers } from './modules/identity/users.resolvers';
import { UsersService } from './modules/identity/users.service';
import { insightsResolvers } from './modules/insights/insights.resolvers';
import { InsightsService } from './modules/insights/insights.service';
import { INSIGHTS_BINDINGS, insightsSubscriptions } from './modules/insights/insights.subscriptions';
import { moderationResolvers } from './modules/moderation/moderation.resolvers';
import { ModerationService } from './modules/moderation/moderation.service';
import { moderationSubscriptions, SUBSCRIPTION_BINDINGS } from './modules/moderation/moderation.subscriptions';

const busLogger = new Logger('EventBus');

export const GATEWAY_CONFIG = Symbol('GATEWAY_CONFIG');
export const GRAPHQL_SERVER = Symbol('GRAPHQL_SERVER');
export const EVENT_BUS = Symbol('EVENT_BUS');

/** Deep-merges resolver maps by type name. */
function mergeResolvers(...maps: Record<string, Record<string, unknown>>[]): Record<string, unknown> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const map of maps) for (const [type, fields] of Object.entries(map)) out[type] = { ...out[type], ...fields };
  return out;
}

export function createDataSources(config: GatewayConfig, fetchImpl?: typeof fetch): DataSources {
  const tokens = new ServiceTokenProvider({
    tokenUrl: `${config.services.identity}/api/v1/auth/service-token`,
    clientId: config.serviceClientId,
    clientSecret: config.serviceClientSecret,
    scopes: config.serviceScopes,
    timeoutMs: config.httpTimeoutMs,
    fetch: fetchImpl,
  });
  const http = (name: string, baseUrl: string) => new ServiceHttp({ name, baseUrl, tokens, timeoutMs: config.httpTimeoutMs, fetch: fetchImpl });
  return {
    identity: new IdentityClient(http('identity-service', config.services.identity)),
    social: new SocialClient(http('social-service', config.services.social)),
    media: new MediaClient(http('media-service', config.services.media)),
    events: new EventsClient(http('events-service', config.services.events)),
    wallet: new WalletClient(http('wallet-service', config.services.wallet)),
    insights: new InsightsClient(http('insights-service', config.services.insights)),
  };
}

@Controller('health')
class HealthController {
  constructor(@Inject(EVENT_BUS) private readonly bus: RabbitEventBus) {}

  @Get('live')
  live() {
    return { status: 'UP' };
  }

  @Get('ready')
  ready() {
    return { status: 'UP', checks: { graphql: 'UP', broker: this.bus.isConnected ? 'UP' : 'DOWN' } };
  }
}

class Lifecycle implements OnApplicationShutdown {
  constructor(
    private readonly server: GraphqlServer,
    private readonly bus: RabbitEventBus,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.server.stop();
    await this.bus.stop();
  }
}

@Module({})
export class AppModule {
  static forRoot(config: GatewayConfig, overrides: { dataSources?: DataSources; fetch?: typeof fetch } = {}): DynamicModule {
    const dataSources = overrides.dataSources ?? createDataSources(config, overrides.fetch);
    const bus = new RabbitEventBus({
      url: config.rabbitmqUrl,
      instanceId: config.instanceId,
      bindings: [...SUBSCRIPTION_BINDINGS, ...INSIGHTS_BINDINGS],
      log: { info: (m) => busLogger.log(m), warn: (m) => busLogger.warn(m), error: (m) => busLogger.error(m) },
    });
    const users = new UsersService(dataSources);
    const moderation = new ModerationService(dataSources);
    const events = new EventsService(dataSources);
    const dashboard = new DashboardService(dataSources, moderation);
    const insights = new InsightsService(dataSources);
    const resolvers = mergeResolvers(
      usersResolvers(users),
      moderationResolvers(moderation),
      moderationSubscriptions(bus, moderation),
      eventsResolvers(events),
      dashboardResolvers(dashboard),
      insightsResolvers(insights),
      insightsSubscriptions(bus, insights),
      {
        Query: { serviceHealth: () => new ServiceHealthService(config, overrides.fetch).report() },
      },
      disabledResolvers as never,
    );
    const server = new GraphqlServer({ config, dataSources, resolvers });

    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [
        { provide: GATEWAY_CONFIG, useValue: config },
        { provide: DATA_SOURCES, useValue: dataSources },
        { provide: EVENT_BUS, useValue: bus },
        { provide: GRAPHQL_SERVER, useValue: server },
        { provide: Lifecycle, useValue: new Lifecycle(server, bus) },
      ],
    };
  }
}
