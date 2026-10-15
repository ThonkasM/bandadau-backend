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

## Arquitectura: capas (implementada)

No usa Clean. Regla (`pnpm arch`): **resolvers → services → data-sources → common**, nunca al revés.

```
schema/admin.graphql          copia EXACTA del contrato (bandadau-docs); `pnpm schema:sync [--check]` y prueba de igualdad
src/
├── main.ts  bootstrap.ts  app.module.ts       Nest solo para DI, ciclo de vida y /health; Apollo se monta antes de init()
├── config/env.ts
├── common/   errors.ts (ServiceHttpError, UserError, FEATURE_DISABLED…), http-client.ts (token de servicio, timeout, 1 reintento GET), relay.ts
├── data-sources/   identity|social|media|events|wallet .client.ts, data-sources.ts, types.ts
├── graphql/
│   ├── schema.ts            makeExecutableSchema + @auth (mapSchema) + exige sesión en campos raíz
│   ├── graphql-server.ts    Apollo Server 5 (express5) + graphql-ws en /graphql, contexto por petición, formatError, errores parciales
│   ├── context.ts           DataLoaders por petición (users por `ids`, profiles, media urls, universities, sagas)
│   ├── scalars.ts  validation-rules.ts (profundidad y complejidad)
│   └── pubsub/rabbit-event-bus.ts   cola exclusiva auto-delete `admin-gateway.subscriptions.<instanceId>`
└── modules/{identity,moderation,events,dashboard,health,disabled}/   *.service.ts + *.resolvers.ts (+ mappers/subscriptions)
test/{unit,integration}
```

## Comandos

Proyecto independiente (sin workspace). Ver `README.md`.

```bash
corepack pnpm dev | build | start | schema:sync | test | test:int | lint | typecheck | arch
docker build --build-context shared=../bandadau-shared -f services/admin-gateway/Dockerfile -t bandada/admin-gateway:local .   # desde bandadau-backend
```

## Variables de entorno (`.env.example` completo)

`PORT`, `NODE_ENV`, `JWKS_URL`, `JWT_ISSUER`, `JWT_AUDIENCE` (`bandada-admin`), `IDENTITY_URL`, `SOCIAL_SERVICE_URL`, `MEDIA_SERVICE_URL`,
`EVENTS_SERVICE_URL`, `WALLET_SERVICE_URL`, `TICKETING_SERVICE_URL`, `NOTIFICATION_SERVICE_URL`, `INSIGHTS_SERVICE_URL` (fase 2, no usado),
`SERVICE_CLIENT_ID`, `SERVICE_CLIENT_SECRET`, `SERVICE_TOKEN_SCOPES` (`internal:read,internal:write`), `RABBITMQ_URL`,
`RABBITMQ_MANAGEMENT_URL/USER/PASSWORD` (opcional, `serviceHealth.queues`; usuario `monitor`), `GRAPHQL_MAX_DEPTH` (7), `GRAPHQL_MAX_COMPLEXITY` (1000),
`GRAPHQL_INTROSPECTION` y `GRAPHQL_LANDING_PAGE` (por defecto activos solo si `NODE_ENV != production`), `CORS_ORIGINS` (con credenciales),
`HTTP_TIMEOUT_MS`, `DEFAULT_LOCALE`, `INSTANCE_ID`.

## Puertos y rutas

Dev **7010**. `/graphql` (POST + WebSocket `graphql-ws`; token en cabecera `Authorization` o en `connectionParams.Authorization`), `/health/live`,
`/health/ready` (incluye estado del broker; no cae si RabbitMQ está caído, reconecta cada 5 s).

## Contratos y cómo se resuelve cada campo (fase 1)

| Campo | Origen |
|---|---|
| `me` | identity `GET /api/v1/users/me` con el **token del usuario** |
| `users`, `user` | identity `GET /internal/v1/users` (`ids` para el DataLoader; `user(id)` = `ids=<id>`) |
| `universities` | identity `GET /api/v1/universities` (público) |
| `updateUserRoles`, `suspendUser`, `reactivateUser`, `createUniversity` | identity `/internal/v1` con `X-Actor-Id` |
| `moderationQueue` | media `GET /internal/v1/media` (FLAGGED) + social `GET /internal/v1/posts` (HIDDEN); mezcla por antigüedad, cursor = offset |
| `contentReports`, `resolveContentReport` | social `/internal/v1/reports` |
| `moderateMedia` | media `POST /internal/v1/media/{id}/decision` |
| `events`, `registrations`, `Event.registrations`, `sagas`, `retrySaga` | events `/internal/v1/**` |
| `event(id)` | events `GET /api/v1/events/{id}` con el token del usuario |
| `dashboard`, `walletStats` | social `stats/daily`, events `stats/registrations`, wallet `stats/credits`, identity (conteo `newUsers`), cola de moderación |
| `serviceHealth` | `GET /health/ready` de identity, social, media, events, wallet, ticketing y notification + management API de RabbitMQ |
| `moderationQueueChanged` | RabbitMQ: `media.asset.#`, `social.content.reported.v1`, `social.post.hidden.v1` |
| Fase 2: `reports`, `report`, `alerts`, `agentRuns`, `requestReport`, `acknowledgeAlert`, `runMonitoringNow`, `createMcpToken`, `revokeMcpToken`, `alertRaised`, `reportReady` | error `extensions.code = FEATURE_DISABLED` |

## Reglas específicas y gotchas

- Errores: autenticación/autorización → `UNAUTHENTICATED`/`FORBIDDEN`; errores de negocio de mutaciones → `errors: [UserError]` con el `code` del Problem de origen;
  fallo de un servicio en queries → error con `extensions.code` (el del Problem, o `SERVICE_UNAVAILABLE`); `dashboard` degrada a ceros + error parcial
  (`extensions.degraded = true`) en vez de caer. `QUERY_TOO_DEEP` / `QUERY_TOO_COMPLEX` para los límites. Errores internos no filtran detalles.
- Persisted queries desactivadas; introspección y landing page solo en dev; CSRF prevention activo.
- Complejidad: cada campo cuesta 1 y un campo con `first`/`limit` multiplica a sus hijos (máx. 100). El límite 1000 admite p. ej. `users(first: 20)` con ~10 campos.
- Cada petición WebSocket crea DataLoaders **sin caché** para no servir datos viejos durante una suscripción larga.
- Mensajes de `UserError` y `Accept-Language`: se propaga la cabecera a los servicios; los textos vienen localizados del servicio de origen.
- Jest transpila con SWC porque `jose` 6 es solo ESM.
- **Divergencias de contrato** (reportar en bandadau-docs): (1) no existe `GET /internal/v1/users/{id}` ni filtro `ids` en el OpenAPI de identity, pero
  identity-service ya implementa `ids` y se usa para el DataLoader; (2) `suspendUser.until` no tiene campo equivalente en `UpdateUserStatusRequest` → se ignora;
  (3) `User.suspendedAt/suspensionReason` no vienen del servicio (solo se rellenan tras suspender en la misma petición); (4) no hay `GET` interno de evento ni de post:
  `event(id)` usa la API pública con el token del usuario y `ContentReport.post` devuelve `null`; (5) `Registration.saga` se resuelve buscando entre las
  100 SAGAs más recientes; (6) el AGENTS original hablaba de `X-Acting-User`: el contrato usa `X-Actor-Id`; (7) la cola `admin-gateway.subscriptions.<id>` no figura aún
  en el catálogo (ADR pendiente) y el usuario RabbitMQ del gateway debe poder declararla; (8) los eventos de moderación no traen el contenido completo, así que el `item`
  de la suscripción es mínimo (el cliente refresca con `moderationQueue`).

## Casos de uso

UC-18 (moderar), UC-19 (reporte, vía insights), UC-20 (alertas en vivo), UC-21 (gestionar usuarios y roles),
dashboard del panel.

## Definición de hecho

`definition-of-done.md` §0, §9 (contrato GraphQL) + pruebas de resolvers con data sources falsos, límites de
profundidad/complejidad, autorización por rol y Pact como consumidor.
