# AGENTS.md — admin-gateway (S9)

Lee primero el `AGENTS.md` del workspace (`../../../AGENTS.md`), el del repo (`../../AGENTS.md`), `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`,
`bandadau-docs/docs/03-arquitectura/decisiones-clave.md` (D11), `bandadau-docs/docs/03-arquitectura/graphql-admin.md` y
`bandadau-docs/docs/04-patrones-y-reglas/api-rest-guidelines.md` §11 (llamadas internas).

## Identidad

**BFF GraphQL** del panel de administración (T3): agrega `/internal/v1/**` de identity, social,
media, events, wallet, ticketing e insights para el `admin-shell` y los MFEs. **Sin estado** y
sin base de datos propia (caché opcional en memoria). Subscriptions en tiempo real (`graphql-ws`).

## Stack

TypeScript · NestJS 11 · Node 24 · Apollo Server 5 (integración NestJS: verificar paquete y
compatibilidad con Nest 11) · `graphql-ws` · DataLoader · RabbitMQ (solo para alimentar
subscriptions) · `@bandada/auth-ts`, `@bandada/contracts-ts` · Jest/Vitest · dependency-cruiser.

## Arquitectura: capas (resolvers → services → data sources)

No usa Clean: es un adaptador de agregación. Regla: **resolvers → services → data-sources**, nunca al revés.

```
src/
├── main.ts  app.module.ts
├── config/                 env.schema.ts
├── graphql/
│   ├── schema.ts           carga bandadau-docs/contracts/graphql/admin.graphql (schema-first)
│   ├── directives/         auth.directive.ts (@auth(requires: [...]))
│   ├── scalars/            DateTime, UUID
│   ├── plugins/            depth-limit (7), complexity-limit, error-formatter (extensions.code), otel
│   └── pubsub/             rabbit-pubsub.ts (alertRaised, moderationQueueChanged, reportReady)
├── modules/<dominio>/      users, universities, moderation, events, sagas, wallet, insights, dashboard, health
│   ├── <dominio>.resolver.ts
│   ├── <dominio>.service.ts      (composición, mapeo a tipos GraphQL, paginación Relay)
│   └── <dominio>.loaders.ts      (DataLoader por petición)
├── data-sources/           identity.client.ts, social.client.ts, media.client.ts, events.client.ts,
│                           wallet.client.ts, ticketing.client.ts, insights.client.ts
│                           (HTTP con token de servicio, timeout, retry, circuit breaker)
└── common/                 service-token.provider.ts, correlation.ts, relay-pagination.ts
test/
```

## Comandos (propuestos)

```bash
pnpm --filter admin-gateway dev             # :7010 (/graphql HTTP + WS)
pnpm --filter admin-gateway test | test:int | lint | typecheck | arch | build
(cd ../bandadau-docs && make contracts-lint)  # incluye graphql-inspector sobre admin.graphql
```

## Variables de entorno (`.env.example`)

```
PORT=7010
JWKS_URL=http://localhost:7001/.well-known/jwks.json
JWT_ISSUER=http://api.bandada.localhost
IDENTITY_URL=http://localhost:7001
SOCIAL_SERVICE_URL=http://localhost:7002
MEDIA_SERVICE_URL=http://localhost:7003
EVENTS_SERVICE_URL=http://localhost:7004
WALLET_SERVICE_URL=http://localhost:7005
TICKETING_SERVICE_URL=http://localhost:7006
INSIGHTS_SERVICE_URL=http://localhost:7008
SERVICE_CLIENT_ID=admin-gateway
SERVICE_CLIENT_SECRET=change-me
RABBITMQ_URL=amqp://bandada:bandada@localhost:5672
GRAPHQL_MAX_DEPTH=7
GRAPHQL_MAX_COMPLEXITY=1000
GRAPHQL_INTROSPECTION=true                 # false en producción
HTTP_TIMEOUT_MS=3000
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=admin-gateway
```

## Puertos y rutas

Dev **7010**. `/graphql` (HTTP POST + WebSocket `graphql-ws`), `/health/live`, `/health/ready`.

## Contratos

- Implementa `bandadau-docs/contracts/graphql/admin.graphql` (Query/Mutation/Subscription de D11, incluidos
  `User.locale`, `User.theme`, `requestReport(question, locale)`).
- Consume los OpenAPI `/internal` de los servicios (verificado con Pact como consumidor).

## Mensajería

- **Consume** (cola propia efímera/exclusiva por instancia, **añadir al catálogo vía ADR**):
  `bandada.insights.alert.raised.v1`, `bandada.media.asset.flagged.v1`, `bandada.social.content.reported.v1`,
  `bandada.insights.report.ready.v1` → subscriptions.
- **Publica**: nada.

## Datos

Ninguno. Caché en memoria opcional (TTL corto) para `universities` y `serviceHealth`.

## Reglas específicas y gotchas

- Autorización por directiva `@auth(requires: [ADMIN])` / `[MODERATOR]` en el schema; además los servicios
  validan el token de servicio. El `sub` del admin se propaga (cabecera `X-Acting-User`) para auditoría.
- **Propagar `Accept-Language`** del panel a los servicios; errores GraphQL con `extensions.code` estable
  (el `code` del Problem Details de origen) y mensaje localizado.
- DataLoader **por petición** (nunca global) para evitar N+1 y fugas entre usuarios.
- Paginación Relay (`Connection/Edge/PageInfo`) traduciendo el `nextCursor` de los servicios.
- Fallo parcial de un servicio → `null` en ese campo + error en `errors[]` (no tumbar toda la query);
  en `dashboard` marcar `degraded: true`.
- Nunca acceder a bases de datos ni a RabbitMQ para *queries*; solo REST interno.
- Introspección y playground deshabilitados en producción.

## Casos de uso

UC-18 (moderar), UC-19 (reporte, vía insights), UC-20 (alertas en vivo), UC-21 (gestionar usuarios y roles),
dashboard del panel.

## Definición de hecho

`definition-of-done.md` §0, §9 (contrato GraphQL) + pruebas de resolvers con data sources falsos, límites de
profundidad/complejidad, autorización por rol y Pact como consumidor.
