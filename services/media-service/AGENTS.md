# AGENTS.md — media-service (S3)

Lee primero el `AGENTS.md` del workspace (`../../../AGENTS.md`), el del repo (`../../AGENTS.md`), `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`,
`bandadau-docs/docs/04-patrones-y-reglas/clean-architecture.md` y `bandadau-docs/docs/06-plan/fase-1-alcance-y-contrato-local.md` (normativo para la fase 1).

## Identidad

Multimedia: subidas directas a S3/MinIO con URL prefirmada, moderación y URLs de lectura. **Fase 1**: sin ONNX/ffmpeg; `MODERATION_MODE=allow-all` (→ `APPROVED`) o `manual` (→ `FLAGGED`,
cola del panel UC-18) detrás del puerto `ModerationPort` (`Phase1ModerationAdapter`); en fase 2 solo se sustituye el adaptador por los clasificadores ONNX (el contrato de eventos no cambia).
Casos de uso: UC-05, UC-04 (avatar), UC-11 (portada), UC-18.

## Stack

TypeScript 5.9 · NestJS 11.2 · Node 24 · MongoDB 8 (`media`, `rs0`, driver nativo) · `@aws-sdk/client-s3` + `s3-request-presigner` · `sharp` (miniatura JPEG 512 px; HEIC no) ·
zod 4 · `@bandada/{auth-ts,idempotency-ts,messaging-ts,i18n,contracts-ts}` · Jest 30.

## Arquitectura: Clean Architecture

```
src/
├── entities/            media-asset.entity.ts (límites, HeadObject, transiciones, decisión humana), errors/
├── use-cases/           ports/ (MediaRepository, ObjectStorage, ThumbnailGenerator, ModerationPort, EventPublisher, UnitOfWork, Clock, IdGenerator),
│                        uploads/ (create, complete), moderation/ (process, decide), queries/ (get, urls, internal, flagged), post-events.use-case.ts
├── interface-adapters/  controllers/{http, messaging}, presenters/, gateways/{mongo, s3 (S3ObjectStorage), moderation (fase 1), messaging (outbox)}
└── frameworks-drivers/  main.ts, app.module.ts, modules/ (composition root + ProcessingWorker), config/env.ts, database/indexes.ts
```

- El cliente sube **directo** a S3; las URLs se firman con `S3_PUBLIC_ENDPOINT` (el host entra en la firma), las llamadas de datos usan `S3_ENDPOINT`.
- `completeUpload` responde 202: HeadObject (existe/tamaño/tipo → `UPLOAD_MISSING|UPLOAD_MISMATCH|UPLOAD_EXPIRED`), CAS `PENDING_UPLOAD→PROCESSING` y un worker en proceso (`ProcessingWorker`)
  genera la miniatura, llama al `ModerationPort` y publica el evento por outbox en la misma transacción. Un barrido re-encola `PROCESSING` >`STALE_PROCESSING_MS` y purga `PENDING_UPLOAD` >24 h.
- Los magic bytes del objeto no se verifican en fase 1 (solo `Content-Type` y tamaño de HeadObject).

## Comandos (proyecto independiente: `corepack pnpm`, pnpm@10.34.7)

```bash
(cd ../../../bandadau-shared && corepack pnpm install --frozen-lockfile && corepack pnpm build)   # previo
corepack pnpm install && corepack pnpm dev      # :7003
corepack pnpm test                              # unitarias
corepack pnpm test:int                          # integración real: MinIO (PUT/GET prefirmados), Mongo rs0, DynamoDB Local; BD temporal media_it_*
corepack pnpm lint && corepack pnpm typecheck && corepack pnpm arch && corepack pnpm build
```

Variables de prueba: `TEST_MONGO_URI`, `TEST_DYNAMODB_ENDPOINT`, `TEST_S3_ENDPOINT/KEY/SECRET` (por defecto `localhost:9000`, `media-svc`).

## Variables de entorno

`.env.example`: `PORT=7003`, `MONGODB_URI`, `RABBITMQ_URL`, `JWKS_URL`, `JWT_ISSUER`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET_MEDIA`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`S3_FORCE_PATH_STYLE`, `UPLOAD_URL_TTL_SECONDS` (900), `MAX_IMAGE_BYTES`, `MAX_VIDEO_BYTES`, `MODERATION_MODE`, `IDEMPOTENCY_TABLE`, `DYNAMODB_ENDPOINT`, `CORS_ORIGINS`, `RATE_LIMIT_PER_MINUTE`, `OUTBOX_POLL_MS`, `STALE_PROCESSING_MS`.
Las de modelos/ffmpeg (`MODEL_*`, `MODERATION_*_THRESHOLD`, `VIDEO_*`) se aceptan y se ignoran hasta la fase 2.

## Puertos y rutas

Dev **7003**. Público `/api/v1/media/{uploads,{mediaId}/complete,{mediaId}}`. Interno `/internal/v1/media` (`listFlaggedMedia`), `/urls` (`getMediaUrls`, `includeUnapproved` solo desde admin-gateway),
`/{mediaId}` (`getMediaInternal`), `/{mediaId}/decision` (`decideMedia`, `X-Actor-Id`). `/health/live|ready`.

## Mensajería

- **Publica** por outbox: `bandada.media.asset.approved.v1` (`decision: ALLOW`, `reviewedBy` null o el moderador), `…flagged.v1` (`decision: REVIEW`), `…rejected.v1` (`source: AUTOMATIC|MODERATOR`).
- **Consume** `media-service.events`: `bandada.social.post.deleted.v1` (borra original y miniatura de los medios del autor; idempotente).

## Datos

Mongo `media`: `mediaAssets` (con `moderationResults[]` y `finalDecision` embebidos), `outbox`, `processedMessages`. S3: `media/<ownerId>/<mediaId>/original` y `…/thumbnail.jpg` (bucket privado).

## Reglas específicas

- Imagen `jpeg|png|webp|heic` ≤ 10 MB; video `mp4|quicktime` ≤ 50 MB y ≤ 60 s declarados (`durationSeconds` obligatorio); `AVATAR`/`EVENT_COVER` solo imagen.
- `getMedia`: dueño en cualquier estado; el resto solo `APPROVED` (si no, 404). `getMediaUrls`: ids inexistentes se omiten; URLs `null` si no está `APPROVED`.
- `decideMedia` solo sobre `FLAGGED` (`409 MEDIA_NOT_FLAGGED`); repetir la misma decisión responde 200 sin cambios ni evento.
- Problem Details localizados (`@bandada/i18n`).

## Definición de hecho (cubierto)

Integración: PUT prefirmado real contra MinIO, `completeUpload` (202 → APPROVED con miniatura y un solo evento), objeto ausente/distinto, modo `manual` → cola `FLAGGED` → `decideMedia` (approved/rejected), `getMediaUrls`, borrado por `post.deleted`.
