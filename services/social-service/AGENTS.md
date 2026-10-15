# AGENTS.md — social-service (S2)

Lee primero el `AGENTS.md` del workspace (`../../../AGENTS.md`), el del repo (`../../AGENTS.md`), `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`,
`bandadau-docs/docs/04-patrones-y-reglas/clean-architecture.md` y `bandadau-docs/docs/06-plan/fase-1-alcance-y-contrato-local.md` (normativo para la fase 1).

## Identidad

Red social: perfiles académicos, posts (texto/imagen/video), comentarios, reacciones, seguimientos, grupos de estudio, denuncias y feed.
Casos de uso UC-04…UC-10; soporta UC-18 (`/internal`). **Fase 1**: feed cronológico (puntaje = recencia, cursor estable `(createdAt,id)`), `getFollowSuggestions`
vacío, sin ranker ML.

## Stack

TypeScript 5.9 · NestJS 11.2 · Node 24 · MongoDB 8 (`social`, replica set `rs0`) con el **driver nativo `mongodb` 7** (sin Mongoose: el inbox/outbox de
`@bandada/messaging-ts` trabaja con `ClientSession`) · zod 4 (entrada → `400 VALIDATION_FAILED` con `errors[]`) · `@bandada/{auth-ts,idempotency-ts,messaging-ts,i18n,contracts-ts}` ·
Jest 30 + ts-jest · dependency-cruiser · ESLint (`@bandada/eslint-config/node`).

## Arquitectura: Clean Architecture

```
src/
├── entities/            post, profile, group, comment, content-report, follow, value-objects/ (post-text, media), policies/ (visibilidad, reportes, recencia), errors/
├── use-cases/           ports/ (repositorios, MediaGateway, EventPublisher, UnitOfWork, Clock, IdGenerator), posts/ feed/ comments/ reactions/ follows/
│                        groups/ reports/ profiles/ media-events/ identity-events/, events.ts (fábrica de eventos), outputs.ts
├── interface-adapters/  controllers/{http (+dto/schemas zod), messaging}, presenters/ (contrato, Problem Details, cursor), gateways/{mongo, messaging (outbox), http (media-service)}
└── frameworks-drivers/  main.ts, app.module.ts, modules/ (composition root con factories), config/env.ts (fail fast), database/indexes.ts
test/{unit,integration,support}
```

- Casos de uso sin `@Injectable` (factory `useFactory` en `modules/social.module.ts`), puertos con `Symbol`.
- `UnitOfWork` = transacción Mongo; la sesión viaja por `AsyncLocalStorage` (`MongoContext`) y los repos se unen a ella; el consumidor del inbox reutiliza `ctx.tx`.
  `work` puede reejecutarse (reintento transitorio): sin efectos externos dentro.
- No capturar errores de clave duplicada **dentro** de una transacción (la aborta): se usa `upsert + $setOnInsert` (follows, membresías, reacciones). `createPost` captura
  `DUPLICATE_CLIENT_ID` **fuera** de la transacción y devuelve el post existente (200).
- Eventos solo por outbox (`OutboxEventPublisher` → colección `outbox`, relay cada `OUTBOX_POLL_MS`).
- `dependency-cruiser` (`.dependency-cruiser.cjs`) falla `pnpm build` si entities/use-cases importan adaptadores, frameworks, `@bandada/*` o módulos de Node.

## Comandos (proyecto independiente: `corepack pnpm`, pnpm@10.34.7; sin workspace en la raíz)

```bash
(cd ../../../bandadau-shared && corepack pnpm install --frozen-lockfile && corepack pnpm build)   # previo
corepack pnpm install && corepack pnpm dev      # :7002
corepack pnpm test                              # unitarias (sin infra)
corepack pnpm test:int                          # integración HTTP real: Mongo rs0 + DynamoDB Local (infra viva); BD temporal social_it_*
corepack pnpm lint && corepack pnpm typecheck && corepack pnpm arch && corepack pnpm build
```

Jest corre con `NODE_OPTIONS=--experimental-vm-modules` (jose es ESM). Pruebas de integración: `TEST_MONGO_URI` (root + `directConnection=true`), `TEST_DYNAMODB_ENDPOINT`.

## Variables de entorno

`.env.example` (validadas con zod al arrancar): `PORT=7002`, `MONGODB_URI`, `RABBITMQ_URL`, `JWKS_URL`, `JWT_ISSUER`, `IDENTITY_URL`, `SERVICE_CLIENT_ID/SECRET`,
`MEDIA_SERVICE_URL`, `MEDIA_HTTP_TIMEOUT_MS`, `IDEMPOTENCY_TABLE`, `DYNAMODB_ENDPOINT`, `AWS_REGION`, `DEFAULT_LOCALE`, `CORS_ORIGINS`, `REPORT_HIDE_THRESHOLD=3`,
`RATE_LIMIT_PER_MINUTE`, `OUTBOX_POLL_MS`, `PENDING_MEDIA_SWEEP_MS`, `MESSAGING_ENABLED`, `INTERNAL_SCOPES_ENFORCED` (default `true`), `LOG_LEVEL`. `FEED_MODEL_PATH`/`OTEL_*` se aceptan y no se usan.

## Puertos y rutas

Dev **7002**. Rutas públicas con prefijo `/api/v1` (Traefik no lo recorta): `profiles`, `posts`, `feed`, `groups`, `follows`, `reports`.
Interno `/internal/v1/{posts (incl. `GET /posts/{postId}` en cualquier estado),reports,profiles,groups,stats/daily}` con `@Internal()` (token de servicio `typ=service`, `aud=bandada-internal`; `InternalScopesGuard` exige `internal:read` en GET e `internal:write` en el resto, `403 FORBIDDEN` si falta; se desactiva con `INTERNAL_SCOPES_ENFORCED=false`).
`/health/live` y `/health/ready` (Mongo + RabbitMQ).

## Contratos

Implementa `bandadau-docs/contracts/openapi/social-service.yaml` completo (23 operaciones públicas + 8 internas, mismos `operationId`; la búsqueda de grupos es `listGroups`).
Consume media-service `GET /internal/v1/media/{id}` y `/internal/v1/media/urls` con `ServiceTokenProvider` (`POST {IDENTITY_URL}/api/v1/auth/service-token`), timeout y circuit breaker.

## Mensajería

- **Publica** (outbox, `source=/services/social-service`): `bandada.social.{post.created,post.published,post.hidden,post.deleted,post.removed,comment.created,comment.hidden,reaction.set,follow.created,group.join-requested,content.reported}.v1`.
- **Consume** `social-service.events` (inbox `processedMessages`, topología solo verificada): `bandada.media.asset.{approved,flagged,rejected}.v1`,
  `bandada.identity.user.{registered,suspended,reactivated}.v1`; `role-changed`/`preferences-changed` se reconocen sin efecto (si no irían a la DLQ).

## Datos (Mongo `social`)

`profiles`, `posts` (único `{authorId,clientId}`), `comments`, `reactions` (único `{postId,userId}`), `follows`, `groups`, `groupMemberships`, `contentReports`
(único `{targetType,targetId,reporterId}`), `mediaAssetViews`, `outbox`, `processedMessages`. Índices idempotentes al arrancar (`database/indexes.ts`).

## Reglas específicas y gotchas

- `mediaAssetViews` = read model de estados de medios (por eventos). `createPost` lo consulta primero y llama a media-service solo por ids desconocidos/no finales; media-service caído ⇒ `503`. `getMediaUrls` degrada a URLs `null` (feed/post nunca fallan).
- PENDING_MEDIA → PUBLISHED solo cuando **todos** los medios están APPROVED; FLAGGED/REJECTED ⇒ HIDDEN (`MEDIA_FLAGGED`); un `APPROVE` humano posterior lo republica. Barrido (`PENDING_MEDIA_SWEEP_MS`) para carreras evento/post y ocultar los pendientes >24 h.
- Avatar: `pendingAvatarMediaId` hasta `asset.approved` del mismo dueño; si el asset ya está APPROVED se promueve al instante; FLAGGED/REJECTED ⇒ `422 MEDIA_NOT_APPROVED`. `Profile.avatarStatus` (`PENDING|APPROVED|REJECTED|null`) se persiste en `profiles`; `REJECTED` = el medio pendiente fue rechazado por evento (se conserva el avatar anterior).
- Denuncias: `$inc` atómico + `updateOne({status:'PUBLISHED'})` condicional dentro de una transacción ⇒ `post.hidden` sale una sola vez aun con denuncias concurrentes.
- Suspensión de autor oculta posts (`hiddenReason=AUTHOR_SUSPENDED`; el AsyncAPI lo lista como propuesta) y comentarios; la reactivación los restaura. En `/internal` se presenta tal cual (`AUTHOR_SUSPENDED`).
- `REMOVED` por moderador ⇒ `post.removed` (contenido conservado); `post.deleted` solo por borrado del autor (media-service borra objetos).
- Problem Details con `code` estable y `title/detail` de `@bandada/i18n` según `Accept-Language`; los 404 usan `POST_NOT_FOUND`/`COMMENT_NOT_FOUND`/`PROFILE_NOT_FOUND`/`GROUP_NOT_FOUND` (este último es 422 si es un `groupId` del cuerpo de `createPost`); `NOT_FOUND` genérico solo para denuncias y membresías.
- El JWT de usuario es `typ=user`, `aud=bandada-app|bandada-admin` (lo emite identity-service).

## Definición de hecho (cubierto)

Pruebas de integración: `createPost` idempotente (misma clave / mismo `clientId` / 6 concurrentes), PENDING_MEDIA → PUBLISHED al aprobarse todos los medios (incluye evento duplicado),
3 denuncias distintas ocultan una sola vez (4 concurrentes), comentario idempotente, grupo privado (solicitud, aprobación, salida, rechazo), feed con cursor sin duplicados y filtro de visibilidad.
