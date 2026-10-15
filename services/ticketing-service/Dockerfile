# syntax=docker/dockerfile:1
# Build context: bandadau-backend (compose: `context: ../bandadau-backend`, `additional_contexts: shared: ../bandadau-shared`).
# The sibling layout (/work/bandadau-backend, /work/bandadau-shared) keeps `file:../../../bandadau-shared/packages/<pkg>` valid.

FROM node:24-slim AS shared-build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /work
COPY --from=shared . /work/bandadau-shared
RUN cd /work/bandadau-shared \
 && corepack enable \
 && pnpm install --frozen-lockfile --filter "@bandada/auth-ts..." --filter "@bandada/idempotency-ts..." --filter "@bandada/messaging-ts..." --filter "@bandada/i18n..." --filter "@bandada/contracts-ts..." --filter "@bandada/tsconfig..." --filter "@bandada/eslint-config..." \
 && pnpm --filter "@bandada/auth-ts" --filter "@bandada/idempotency-ts" --filter "@bandada/messaging-ts" --filter "@bandada/i18n" --filter "@bandada/contracts-ts" --filter "@bandada/tsconfig" --filter "@bandada/eslint-config" build

FROM shared-build AS build
WORKDIR /work/bandadau-backend/services/ticketing-service
COPY services/ticketing-service/package.json services/ticketing-service/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY services/ticketing-service/tsconfig.json services/ticketing-service/tsconfig.build.json services/ticketing-service/nest-cli.json ./
COPY services/ticketing-service/src ./src
RUN pnpm build

FROM shared-build AS prod-deps
WORKDIR /work/bandadau-backend/services/ticketing-service
COPY services/ticketing-service/package.json services/ticketing-service/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile

FROM node:24-slim AS runtime
ENV NODE_ENV=production PORT=7006
RUN apt-get update \
 && apt-get install -y --no-install-recommends wget \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=prod-deps --chown=node:node /work/bandadau-backend/services/ticketing-service/node_modules ./node_modules
COPY --from=build --chown=node:node /work/bandadau-backend/services/ticketing-service/dist ./dist
COPY --chown=node:node services/ticketing-service/package.json ./package.json
USER node
EXPOSE 7006
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:7006/health/ready >/dev/null || exit 1
CMD ["node", "dist/frameworks-drivers/main.js"]
