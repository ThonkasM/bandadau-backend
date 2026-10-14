# AGENTS.md — social-service (S2)

Lee primero el `AGENTS.md` del workspace (`../../../AGENTS.md`), el del repo (`../../AGENTS.md`), `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md` y
`bandadau-docs/docs/04-patrones-y-reglas/clean-architecture.md` (el ejemplo `CreatePost` es de este servicio).

## Identidad

Red social: perfiles académicos, posts (texto/imagen/video), comentarios, reacciones,
seguimientos, grupos de estudio, denuncias, **feed personalizado** (ML `feed-ranker`) y
**sugerencias** (`follow-suggester`). Mantiene una réplica local mínima de usuarios a
partir de `bandada.identity.user.*`.

## Stack

TypeScript · NestJS 11 · Node 24 · MongoDB 8 (`social`, replica set `rs0`) con Mongoose ·
RabbitMQ (`@bandada/messaging-ts`) · `@bandada/auth-ts`, `@bandada/idempotency-ts`,
`@bandada/contracts-ts` · OpenTelemetry · Jest o Vitest (elegir uno al crear el servicio y
fijarlo aquí) · Testcontainers · dependency-cruiser. Verificar APIs de NestJS 11 y Mongoose instalados.

## Arquitectura: Clean Architecture

```
src/
├── entities/            post, comment, reaction, profile, group, group-membership, follow,
│                        content-report, value-objects/, policies/ (feed-ranking, follow-suggestion), errors/
├── use-cases/           ports/, posts/, feed/, comments/, reactions/, follows/, groups/,
│                        reports/, profiles/, media-events/, identity-events/, internal/
├── interface-adapters/  controllers/{http,messaging}, presenters/, gateways/{mongo,messaging,http,ml}
└── frameworks-drivers/  main.ts, app.module.ts, modules/, config/, database/, messaging/, observability/
locales/{es,en}/errors.json   test/{unit,integration,e2e}
```

## Comandos (propuestos, desde la raíz de `bandadau-backend` con su pnpm workspace)

```bash
pnpm --filter social-service dev          # :7002 (watch)
pnpm --filter social-service test         # unit
pnpm --filter social-service test:int     # Testcontainers (Mongo rs0, RabbitMQ)
pnpm --filter social-service test:e2e
pnpm --filter social-service lint && pnpm --filter social-service typecheck
pnpm --filter social-service arch         # dependency-cruiser
pnpm --filter social-service build
```

## Variables de entorno (`.env.example`)

```
PORT=7002
MONGODB_URI=mongodb://localhost:27017/social?replicaSet=rs0
RABBITMQ_URL=amqp://bandada:bandada@localhost:5672
JWKS_URL=http://localhost:7001/.well-known/jwks.json
JWT_ISSUER=http://api.bandada.localhost
IDENTITY_URL=http://localhost:7001
SERVICE_CLIENT_ID=social-service
SERVICE_CLIENT_SECRET=change-me
MEDIA_SERVICE_URL=http://localhost:7003
FEED_MODEL_PATH=./models/feed-ranker/coefficients.json
IDEMPOTENCY_TABLE=bandada-idempotency
DYNAMODB_ENDPOINT=http://localhost:8000
AWS_REGION=us-east-1
DEFAULT_LOCALE=es
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=social-service
```

## Puertos y rutas

Dev **7002**. Público: `/api/v1/profiles`, `/posts`, `/feed`, `/groups`, `/follows`,
`/reports`. Interno: `/internal/v1/posts`, `/internal/v1/reports`, `/internal/v1/stats/daily`.

## Contratos

- Implementa `bandadau-docs/contracts/openapi/social-service.yaml` (operaciones de D1: `getMyProfile`,
  `updateMyProfile`, `createPost` ♻️, `getFeed`, `createComment` ♻️, `setReaction`,
  `getFollowSuggestions`, `reportContent` ♻️, grupos…).
- Consume `media-service` `/internal/v1/media` (estado/propiedad de `mediaIds`) con timeout + circuit breaker.

## Mensajería

- **Publica**: `bandada.social.post.created|published|hidden|deleted.v1`,
  `…comment.created.v1`, `…reaction.set.v1`, `…follow.created.v1`,
  `…group.join-requested.v1`, `…content.reported.v1`.
- **Consume** (cola `social-service.events`): `bandada.media.asset.#` (aprobar/ocultar posts
  `PENDING_MEDIA`), `bandada.identity.user.#` (réplica de usuario: nombre, universidad, estado).

## Datos (Mongo `social`)

Colecciones: `profiles`, `posts` (índice único `{authorId, clientId}`), `comments`,
`reactions` (único `{postId, userId}`), `follows` (único `{followerId, followeeId}`),
`groups`, `groupMemberships`, `contentReports`, `userReplicas`, `feedItems` (opcional,
*fan-out on write*), `outbox`, `processedMessages`. Índices creados de forma idempotente al arrancar.

## Reglas específicas y gotchas

- Un post con medios queda `PENDING_MEDIA` hasta que **todos** sus `MediaAsset` estén `APPROVED`
  (invariante 6); un medio `REJECTED` → post `HIDDEN` + notificación al autor.
- `clientId` (UUIDv7 del dispositivo) + índice único = idempotencia offline (D3); el caso de uso
  devuelve el existente ante duplicado.
- Feed: `FeedRankingPolicy` (entities) es pura; los coeficientes los carga un gateway desde JSON
  (`bandadau-ml/notebooks/03-feed-ranker.ipynb`). Cursor incluye versión del ranking.
- Transacciones Mongo requieren replica set (`rs0`): sin él falla el outbox.
- Problem Details localizados por `Accept-Language` (`es` defecto) con `code` estable
  (`MEDIA_REJECTED`, `MEDIA_NOT_OWNED`, `POST_NOT_FOUND`, `ALREADY_MEMBER`…). El contenido de posts
  **no** se traduce ni se loguea.
- `setReaction`/`follow` son idempotentes por naturaleza (PUT).

## Casos de uso

UC-04, UC-05, UC-06, UC-07, UC-08, UC-09, UC-10; soporta UC-18 (estado de posts y denuncias vía
`/internal`) y UC-01 (sugerir grupos desde n8n).

## Definición de hecho

`definition-of-done.md` §0, §2, §3 + dependency-cruiser en verde + prueba de post offline
duplicado y de transición `PENDING_MEDIA → PUBLISHED/HIDDEN` por eventos de media.
