# media-service (S3) — `:7003`

Subidas directas a S3/MinIO con URL prefirmada, moderación (`allow-all` / `manual` de fase 1 y **`onnx`** de fase 2), URLs de lectura prefirmadas (15 min)
y cola de moderación para el panel. NestJS 11 · Node 24 · MongoDB `media` · MinIO (`@aws-sdk/client-s3`) · `sharp` (miniaturas) · Clean Architecture.
`MODERATION_MODE=onnx`: `OnnxModerationAdapter` (onnxruntime-node 1.30, CPU) carga `models/<MODEL_NAME>/<MODEL_VERSION>/` de MinIO (`bandada-models`, caché `MODEL_CACHE_DIR`, sha256 verificado),
clasifica imágenes (sharp 224×224, normalización leída de `metadata.json`) y videos (ffmpeg: 1 fotograma/2 s, máx. 30; score = máximo; `frameScores`; miniatura = mejor fotograma; ≤60 s).
Umbrales: ALLOW < 0.5 ≤ REVIEW < 0.85 ≤ BLOCK (de `metadata.json`, o `MODERATION_*_THRESHOLD`). Si el modelo no carga, **degrada a revisión manual** (todo `FLAGGED`), registra `MODERATION DEGRADED` en logs,
`/health/ready` devuelve `moderation.state: DEGRADED` (sigue 200) y reintenta cada `MODEL_RETRY_MS`. Imagen Docker con ffmpeg (`--build-arg INSTALL_FFMPEG=false` para omitirlo). HEIC no se decodifica: va a revisión humana.

## Quick start

```bash
(cd ../../../bandadau-shared && corepack pnpm install --frozen-lockfile && corepack pnpm build)
corepack pnpm install
cp .env.example .env
corepack pnpm dev               # :7003
curl localhost:7003/health/ready
```

Infra requerida: Mongo `rs0` (usa `directConnection=true` desde el host), RabbitMQ, DynamoDB Local, MinIO (bucket `bandada-media`, usuario `media-svc`).

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm build` | dependency-cruiser + `tsc` |
| `pnpm test` | unitarias (`MediaAsset`: límites, HeadObject, decisión humana) |
| `pnpm test:int` | integración real: **PUT prefirmado contra MinIO**, `completeUpload`, miniatura, GET prefirmado, modo `manual` → cola `FLAGGED` → `decideMedia`, borrado por `post.deleted` (BD temporal `media_it_*`) |
| `pnpm arch` / `pnpm lint` / `pnpm typecheck` | arquitectura, ESLint, tipos |
| `docker compose --profile infra --profile services build media-service` (desde `bandadau-infra`) | imagen `bandada/media-service:local` |

## Variables

Ver `.env.example`. Obligatorias: `MONGODB_URI`, `RABBITMQ_URL`, `JWKS_URL`, `JWT_ISSUER`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`. Claves: `MODERATION_MODE=allow-all|manual`, `UPLOAD_URL_TTL_SECONDS` (900 por defecto; compose actual envía 300),
`MAX_IMAGE_BYTES=10485760`, `MAX_VIDEO_BYTES=52428800`, `S3_PUBLIC_ENDPOINT` (host con el que se **firman** las URLs: debe ser alcanzable por el cliente).

## Endpoints

Implementados: `createUpload` ♻️ (201), `completeUpload` (202, idempotente por estado), `getMedia`; `/internal/v1/media`: `listFlaggedMedia`
(`status`, `ownerId`, `since`, cursor), `getMediaUrls?ids=`, `getMediaInternal`, `decideMedia` (`APPROVE|REJECT`, `X-Actor-Id`). Health `/health/live|ready`.

Flujo: `createUpload` → `PUT uploadUrl` (cabecera `Content-Type` firmada) → `completeUpload` (HeadObject: existe, tamaño y tipo) → `PROCESSING` →
worker en proceso: miniatura (sharp, no HEIC) + `ModerationPort` → `APPROVED`+`asset.approved` (allow-all) o `FLAGGED`+`asset.flagged` (manual).
Un barrido recoge `PROCESSING` atascados (>30 s) y purga `PENDING_UPLOAD` de más de 24 h.

Diferido a fase 2: clasificadores ONNX (NSFW, violencia), CLIP, OCR, frames de video con ffmpeg (el video no se analiza), umbrales 0.5/0.85.

## Mensajería

Cola `media-service.events`: consume `bandada.social.post.deleted.v1` (borra original y miniatura de los medios del autor). Publica por outbox
`bandada.media.asset.{approved,flagged,rejected}.v1`.
