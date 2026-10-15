import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { ApolloServer, type ApolloServerPlugin } from '@apollo/server';
import { unwrapResolverError } from '@apollo/server/errors';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { expressMiddleware } from '@as-integrations/express5';
import { createJwtVerifier, type JwtVerifier } from '@bandada/auth-ts';
import { resolveLocaleFromAcceptLanguage } from '@bandada/i18n';
import type { Express, Request } from 'express';
import express from 'express';
import { GraphQLError, parse, specifiedRules, validate } from 'graphql';
import { useServer } from 'graphql-ws/use/ws';
import { WebSocketServer } from 'ws';

import { ServiceHttpError } from '../common/errors';
import type { GatewayConfig } from '../config/env';
import type { DataSources } from '../data-sources/data-sources';
import { createLoaders, type GatewayContext } from './context';
import { buildSchema } from './schema';
import { complexityLimitRule, depthLimitRule } from './validation-rules';

export interface GraphqlServerDeps {
  config: GatewayConfig;
  dataSources: DataSources;
  resolvers: Record<string, unknown>;
  verifier?: JwtVerifier;
}

const bearerOf = (header: unknown): string | undefined => {
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && /^Bearer\s+\S+$/i.test(value) ? value.replace(/^Bearer\s+/i, '') : undefined;
};

const header = (h: Record<string, unknown>, name: string): string | undefined => {
  const v = h[name];
  return Array.isArray(v) ? (v[0] as string) : (v as string | undefined);
};

/** Apollo Server 5 over Express (HTTP) + graphql-ws (WebSocket), both on `/graphql`. */
export class GraphqlServer {
  private apollo?: ApolloServer<GatewayContext>;
  private wss?: WebSocketServer;
  private disposeWs?: { dispose(): void | Promise<void> };
  private readonly verifier: JwtVerifier;

  constructor(private readonly deps: GraphqlServerDeps) {
    const { config } = deps;
    this.verifier =
      deps.verifier ?? createJwtVerifier({ jwksUrl: config.jwksUrl, issuer: config.jwtIssuer, audience: config.audience, allowedTypes: ['user'] });
  }

  /** Builds the request context. An invalid or missing token leaves `principal` unset; `@auth` then answers UNAUTHENTICATED. */
  async buildContext(headers: Record<string, unknown>, options: { cache?: boolean } = {}): Promise<GatewayContext> {
    const token = bearerOf(headers.authorization);
    let principal: GatewayContext['principal'];
    if (token) principal = await this.verifier.verify(token).catch(() => undefined);
    const locale = headers['accept-language']
      ? resolveLocaleFromAcceptLanguage(header(headers, 'accept-language'))
      : (principal?.locale ?? this.deps.config.defaultLocale);
    const correlationId = header(headers, 'x-correlation-id') ?? randomUUID();
    const call = { actorId: principal?.sub, locale, correlationId };
    return { principal, bearer: token, locale, correlationId, call, loaders: createLoaders(this.deps.dataSources, call, options), partialErrors: [] };
  }

  private partialErrorsPlugin(): ApolloServerPlugin<GatewayContext> {
    return {
      async requestDidStart() {
        return {
          async willSendResponse({ contextValue, response }) {
            if (response.body.kind !== 'single' || contextValue.partialErrors.length === 0) return;
            const extra = contextValue.partialErrors.map((e) => e.toJSON());
            response.body.singleResult.errors = [...(response.body.singleResult.errors ?? []), ...extra] as never;
          },
        };
      },
    };
  }

  async mount(app: Express, httpServer: Server): Promise<void> {
    const { config, resolvers } = this.deps;
    const schema = buildSchema(resolvers);
    const rules = [depthLimitRule(config.maxDepth), complexityLimitRule(config.maxComplexity)];

    this.apollo = new ApolloServer<GatewayContext>({
      schema,
      introspection: config.introspection,
      persistedQueries: false,
      csrfPrevention: true,
      includeStacktraceInErrorResponses: false,
      validationRules: rules,
      plugins: [
        this.partialErrorsPlugin(),
        config.landingPage ? ApolloServerPluginLandingPageLocalDefault({ embed: true, includeCookies: true }) : ApolloServerPluginLandingPageDisabled(),
      ],
      formatError: (formatted, error) => {
        const original = unwrapResolverError(error);
        const inner = (error as GraphQLError).originalError;
        if (formatted.extensions?.code === 'GRAPHQL_VALIDATION_FAILED' && inner instanceof GraphQLError && typeof inner.extensions?.code === 'string') {
          // keep the code of our own validation rules (QUERY_TOO_DEEP, QUERY_TOO_COMPLEX)
          return { ...formatted, extensions: { ...formatted.extensions, ...inner.extensions } };
        }
        if (original instanceof ServiceHttpError) {
          return { ...formatted, message: original.message, extensions: { ...formatted.extensions, code: original.code, status: original.status } };
        }
        if (original instanceof GraphQLError || formatted.extensions?.code) return formatted;
        return { ...formatted, message: 'Internal server error', extensions: { ...formatted.extensions, code: 'INTERNAL_SERVER_ERROR' } };
      },
    });
    await this.apollo.start();

    app.use('/graphql', express.json({ limit: '256kb' }), expressMiddleware(this.apollo, { context: async ({ req }: { req: Request }) => this.buildContext(req.headers as never) }));

    this.wss = new WebSocketServer({ server: httpServer, path: '/graphql' });
    this.disposeWs = useServer(
      {
        schema,
        context: async (ctx) => {
          const params = (ctx.connectionParams ?? {}) as Record<string, unknown>;
          const headers: Record<string, unknown> = { ...(ctx.extra as { request: { headers: Record<string, unknown> } }).request.headers };
          const auth = params.Authorization ?? params.authorization;
          if (auth) headers.authorization = auth;
          return this.buildContext(headers, { cache: false });
        },
        onSubscribe: (_ctx, _id, payload) => {
          const errors = validate(schema, parse(payload.query), [...specifiedRules, ...rules]);
          return errors.length > 0 ? errors : undefined;
        },
      },
      this.wss,
    );
  }

  async stop(): Promise<void> {
    await this.disposeWs?.dispose();
    this.wss?.close();
    await this.apollo?.stop();
  }
}
