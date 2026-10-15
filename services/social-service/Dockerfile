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

WORKDIR /work/bandadau-backend/services/social-service
COPY services/social-service/package.json services/social-service/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY services/social-service/ ./
RUN pnpm build && pnpm prune --prod

FROM node:24-slim AS runtime
ENV NODE_ENV=production COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /work/bandadau-backend/services/social-service/node_modules ./node_modules
COPY --from=build --chown=node:node /work/bandadau-backend/services/social-service/dist ./dist
COPY --from=build --chown=node:node /work/bandadau-backend/services/social-service/package.json ./package.json
USER node
EXPOSE 7002
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD wget -qO- http://127.0.0.1:7002/health/ready >/dev/null || exit 1
CMD ["node", "dist/frameworks-drivers/main.js"]
