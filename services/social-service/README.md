# social-service (S2) — `:7002`

Perfiles, posts, feed, comentarios, reacciones, follows, grupos y denuncias de Bandada U. NestJS 11 · Node 24 ·
TypeScript estricto · MongoDB `social` (replica set `rs0`) · RabbitMQ (outbox/inbox) · Clean Architecture.
Fase 1: feed cronológico (puntaje = recencia), sin ranker ML ni sugerencias.

## Quick start

```bash
# 1) compilar bandadau-shared (una vez)
(cd ../../../bandadau-shared && corepack pnpm install --frozen-lockfile && corepack pnpm build)
# 2) servicio
corepack pnpm install
cp .env.example .env            # ajusta si no usas la infra por defecto
corepack pnpm dev               # compila y arranca en :7002 (watch)
curl localhost:7002/health/ready
```

Infra requerida (`cd ../../../bandadau-infra && make infra-up`): Mongo `rs0`, RabbitMQ, DynamoDB Local y el JWKS de
identity-service. Desde el host usa `directConnection=true` en `MONGODB_URI` (el replica set anuncia `mongo:27017`).

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm build` | `depcruise` (falla si se viola Clean) + `tsc` → `dist/` |
| `pnpm arch` | solo dependency-cruiser |
| `pnpm typecheck` / `pnpm lint` | `tsc --noEmit` / ESLint (`@bandada/eslint-config/node`) |
| `pnpm test` | unitarias (entidades y políticas, sin infra) |
| `pnpm test:int` | integración **HTTP real** contra Mongo `rs0`, DynamoDB Local y MinIO/RabbitMQ en marcha (BD temporal `social_it_*`, se elimina al terminar). Usa `NODE_OPTIONS=--experimental-vm-modules` (jose es ESM) |
| `pnpm test:all` | ambas |
| `docker compose --profile infra --profile services build social-service` (desde `bandadau-infra`) | imagen `bandada/social-service:local` |

Variables de prueba opcionales: `TEST_MONGO_URI` (por defecto `mongodb://root:mongo_dev@localhost:27017/?authSource=admin&directConnection=true`),
`TEST_RABBITMQ_URL`, `TEST_DYNAMODB_ENDPOINT`.

## Variables de entorno

Ver `.env.example` (se valida al arrancar; si falta algo el proceso termina con la lista de errores). Obligatorias:
`MONGODB_URI`, `RABBITMQ_URL`, `JWKS_URL`, `JWT_ISSUER`, `IDENTITY_URL`, `SERVICE_CLIENT_SECRET`, `MEDIA_SERVICE_URL`.
Opcionales con valor por defecto: `PORT=7002`, `IDEMPOTENCY_TABLE=bandada-idempotency`, `DYNAMODB_ENDPOINT`, `AWS_REGION`,
`DEFAULT_LOCALE=es`, `CORS_ORIGINS`, `REPORT_HIDE_THRESHOLD=3`, `RATE_LIMIT_PER_MINUTE=300`, `MEDIA_HTTP_TIMEOUT_MS=1500`,
`OUTBOX_POLL_MS=500`, `PENDING_MEDIA_SWEEP_MS=60000`, `MESSAGING_ENABLED=true`, `LOG_LEVEL=info`.

## Endpoints

Implementados (todos los del contrato `social-service.yaml`, mismos `operationId`):
`getMyProfile`, `updateMyProfile`, `getProfile`, `createPost` ♻️, `getPost`, `deletePost`, `getFeed`, `createComment` ♻️,
`listComments`, `setReaction`, `removeReaction`, `followUser`, `unfollowUser`, `getFollowSuggestions` (siempre `{items:[],nextCursor:null}`),
`createGroup` ♻️, `listGroups`, `getGroup`, `joinGroup`, `listGroupMembers`, `approveGroupMember`, `rejectGroupMember`,
`leaveGroup`, `listGroupPosts`, `reportContent` ♻️; `/internal/v1`: `listPostsByStatus`, `updatePostStatus`,
`listContentReports`, `resolveContentReport`, `getProfileInternal`, `listGroupsInternal`, `getContentDailyStats`.
Health: `GET /health/live`, `GET /health/ready` (Mongo + RabbitMQ).

Diferido a fase 2: ranker ML del feed y snapshot de 10 min (el cursor es `(createdAt, id)` estable), `follow-suggester`, `reasons` en el feed (vacío),
OpenTelemetry (la variable `OTEL_SDK_DISABLED=true` se respeta; no hay SDK instalado).

## Mensajería

Cola `social-service.events` (la crea `bandada-infra`; el servicio solo la verifica): consume `bandada.media.asset.{approved,flagged,rejected}.v1`,
`bandada.identity.user.{registered,suspended,reactivated}.v1` y descarta (ack) `role-changed`/`preferences-changed`. Publica por outbox
(`outbox` en Mongo, relay de 500 ms): `post.{created,published,hidden,deleted,removed}`, `comment.{created,hidden}`, `reaction.set`, `follow.created`,
`group.join-requested`, `content.reported` (todos `bandada.social.*.v1`).
