# AGENTS.md — media-service (S3)

Lee primero el `AGENTS.md` del workspace (`../../../AGENTS.md`), el del repo (`../../AGENTS.md`), `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`,
`bandadau-docs/docs/04-patrones-y-reglas/clean-architecture.md` y `bandadau-docs/docs/03-arquitectura/ml-dl.md`.

## Identidad

Multimedia y **ML/DL de imágenes y video** (T9): subidas directas a S3/MinIO con URL
prefirmada, pipeline de moderación (NSFW, violencia), auto-etiquetado zero-shot (CLIP),
OCR de apuntes, extracción de frames y miniaturas con ffmpeg. Decide `ALLOW/REVIEW/BLOCK`
y alimenta la cola de moderación (UC-18).

## Stack

TypeScript · NestJS 11 · Node 24 · MongoDB 8 (`media`, `rs0`) · S3 / MinIO (`@aws-sdk/client-s3`,
presigner) · `onnxruntime-node` · ffmpeg (binario en la imagen Docker) · RabbitMQ ·
`@bandada/*` · Jest/Vitest + Testcontainers (Mongo, MinIO, RabbitMQ). Verificar versión de
onnxruntime-node compatible con Node 24 y la arquitectura de la imagen (arm64/amd64).

## Arquitectura: Clean Architecture

```
src/
├── entities/            media-asset, moderation-result, media-kind, media-status,
│                        moderation-decision, policies/moderation-thresholds.ts (D7), errors/
├── use-cases/           ports/ (storage, image-classifier, tagger, ocr, frame-extractor,
│                        media.repository, event-publisher, unit-of-work, clock, id-generator)
│                        uploads/ (create-upload, complete-upload), pipeline/ (process-image,
│                        process-video), moderation/ (decide-media, list-flagged), queries/ (get-media),
│                        post-events/ (on-post-deleted)
├── interface-adapters/  controllers/{http,messaging,workers}, presenters/,
│                        gateways/{mongo,s3,onnx,ffmpeg,ocr,messaging}
└── frameworks-drivers/  main.ts, modules/, config/, database/, messaging/, models/ (descarga y caché de .onnx)
test/fixtures/images/   (imágenes sintéticas seguras / "no aptas" de prueba)
```

## Comandos (propuestos)

```bash
pnpm --filter media-service dev           # :7003
pnpm --filter media-service worker        # worker del pipeline (consume tareas internas)
pnpm --filter media-service test | test:int | test:e2e | lint | typecheck | arch | build
pnpm --filter media-service models:pull   # descarga modelos de MinIO a ./models
```

## Variables de entorno (`.env.example`)

```
PORT=7003
MONGODB_URI=mongodb://localhost:27017/media?replicaSet=rs0
RABBITMQ_URL=amqp://bandada:bandada@localhost:5672
JWKS_URL=http://localhost:7001/.well-known/jwks.json
JWT_ISSUER=http://api.bandada.localhost
S3_ENDPOINT=http://localhost:9000
S3_PUBLIC_ENDPOINT=http://localhost:9000
S3_BUCKET_MEDIA=bandada-media
S3_BUCKET_MODELS=bandada-models
S3_ACCESS_KEY_ID=minio
S3_SECRET_ACCESS_KEY=change-me
S3_FORCE_PATH_STYLE=true
AWS_REGION=us-east-1
UPLOAD_URL_TTL_SECONDS=300
MAX_IMAGE_BYTES=10485760
MAX_VIDEO_BYTES=52428800   # 50 MB (RF-06)
MODEL_NSFW_VERSION=1.0.0
MODEL_VIOLENCE_VERSION=1.0.0
MODEL_CLIP_VERSION=1.0.0
MODERATION_BLOCK_THRESHOLD=0.85
MODERATION_REVIEW_THRESHOLD=0.5
VIDEO_FRAME_INTERVAL_SECONDS=2
VIDEO_MAX_FRAMES=30
IDEMPOTENCY_TABLE=bandada-idempotency
DYNAMODB_ENDPOINT=http://localhost:8000
DEFAULT_LOCALE=es
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=media-service
```

## Puertos y rutas

Dev **7003**. Público `/api/v1/media/**`. Interno `/internal/v1/media` (`listFlaggedMedia`,
`decideMedia`, consulta de estados para social).

## Contratos

`bandadau-docs/contracts/openapi/media-service.yaml`: `createUpload` ♻️, `completeUpload`, `getMedia`,
`listFlaggedMedia`, `decideMedia`.

## Mensajería

- **Publica**: `bandada.media.asset.approved.v1`, `…asset.flagged.v1`, `…asset.rejected.v1`
  (incluyen `assetId`, `ownerId`, `labels`, `scores`, `decision`, `modelVersion`).
- **Consume** (`media-service.events`): `bandada.social.post.deleted.v1` (borrado diferido de objetos).

## Datos

Mongo: `mediaAssets`, `moderationResults`, `outbox`, `processedMessages`.
S3: `media/<ownerId>/<mediaId>/original`, `…/thumbnail.jpg`, `models/<nombre>/<versión>/model.onnx`.

## Reglas específicas y gotchas

- El cliente sube **directo** a S3 con la URL prefirmada; el servicio nunca recibe el binario por HTTP.
- `completeUpload` verifica tamaño y tipo real (magic bytes) antes de procesar; si no cuadra → `REJECTED`.
- Umbrales D7: `≥ 0.85` → `BLOCK` (`REJECTED`), `0.5–0.85` → `REVIEW` (`FLAGGED`), `< 0.5` → `ALLOW`.
  Viven en `entities/policies` y se configuran por env, no en adaptadores.
- Video: 1 frame cada 2 s, máx. 30; la decisión es la del peor frame; miniatura = frame de mayor calidad.
- Las sesiones ONNX se cargan **una vez** por proceso (no por petición); inferencia fuera del hilo del
  event loop si bloquea (worker threads) — medir.
- `modelVersion` en cada `ModerationResult`. Modelos > 50 MB nunca en git.
- La decisión humana (`decideMedia`) prevalece sobre la automática y publica el evento correspondiente.
- Problem Details localizados por `Accept-Language`, `code` estable (`UNSUPPORTED_MEDIA_TYPE`, `MEDIA_TOO_LARGE`…).
- URLs prefirmadas con el endpoint **público** (`S3_PUBLIC_ENDPOINT`), no el interno de Docker.

## Casos de uso

UC-05 (publicar contenido), UC-04 (avatar), UC-11 (imagen de evento), UC-18 (moderar), UC-10 (denuncias con medios).

## Definición de hecho

`definition-of-done.md` §0, §2, §3, §6 + prueba de integración con fixtures que cubra las tres
decisiones y un video corto.
