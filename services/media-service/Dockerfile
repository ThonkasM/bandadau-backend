# syntax=docker/dockerfile:1
# Build context: bandadau-backend (additional context "shared" = ../bandadau-shared), as bandadau-infra/docker-compose.yaml expects.
# The sibling layout (/work/bandadau-backend, /work/bandadau-shared) makes `file:../../../bandadau-shared/packages/<pkg>` resolve as on the host.
FROM node:24-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /work

COPY --from=shared . /work/bandadau-shared
RUN cd /work/bandadau-shared \
 && corepack enable \
 && F='--filter @bandada/auth-ts... --filter @bandada/idempotency-ts... --filter @bandada/messaging-ts... --filter @bandada/i18n... --filter @bandada/contracts-ts...' \
 && pnpm install --frozen-lockfile $F \
 && pnpm $F build

WORKDIR /work/bandadau-backend/services/media-service
COPY services/media-service/package.json services/media-service/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY services/media-service/ ./
RUN pnpm build && pnpm prune --prod

FROM node:24-slim AS runtime
ENV NODE_ENV=production COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# ffmpeg/ffprobe (video moderation, MODERATION_MODE=onnx). Build with --build-arg INSTALL_FFMPEG=false for a smaller image without video support.
ARG INSTALL_FFMPEG=true
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates \
 && if [ "$INSTALL_FFMPEG" = "true" ]; then apt-get install -y --no-install-recommends ffmpeg; fi \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /models-cache && chown node:node /models-cache
ENV MODEL_CACHE_DIR=/models-cache
WORKDIR /app
COPY --from=build --chown=node:node /work/bandadau-backend/services/media-service/node_modules ./node_modules
COPY --from=build --chown=node:node /work/bandadau-backend/services/media-service/dist ./dist
COPY --from=build --chown=node:node /work/bandadau-backend/services/media-service/package.json ./package.json
USER node
EXPOSE 7003
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD wget -qO- http://127.0.0.1:7003/health/ready >/dev/null || exit 1
CMD ["node", "dist/frameworks-drivers/main.js"]
