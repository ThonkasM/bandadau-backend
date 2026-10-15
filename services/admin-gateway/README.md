# admin-gateway

BFF GraphQL del panel de administración: agrega los `/internal/v1/**` de identity, social, media, events y wallet.

| | |
|---|---|
| Stack | TypeScript + NestJS 11 · Apollo Server 5 (schema-first) · graphql 16 · graphql-ws · DataLoader |
| Puerto dev | 7010 (`/graphql` HTTP + WebSocket, `/health/live`, `/health/ready`) |
| Casos de uso | UC-18, UC-21, dashboard (UC-19/20 solo declarados: `FEATURE_DISABLED`) |
| Estado | Fase 1 implementada y probada (11 unitarias + 21 de integración con servicios mock y RabbitMQ real) |

## Proyecto independiente

```bash
(cd ../../../bandadau-shared && corepack pnpm install --frozen-lockfile && corepack pnpm build)
corepack pnpm install
cp .env.example .env
corepack pnpm dev                 # :7010
corepack pnpm schema:sync         # copia el SDL del contrato (bandadau-docs) a schema/admin.graphql
corepack pnpm schema:sync --check      # verifica igualdad sin copiar

corepack pnpm test                # unitarias (incluye igualdad del SDL con el contrato si bandadau-docs existe)
corepack pnpm test:int            # integración (necesita un RabbitMQ propio, ver abajo)
corepack pnpm lint && corepack pnpm typecheck && corepack pnpm arch
```

Pruebas de integración: servicios HTTP mock + RabbitMQ real en un contenedor aparte (no la infra compartida):

```bash
docker run -d --name ag-test-rmq -m 512m -e RABBITMQ_DEFAULT_USER=bandada -e RABBITMQ_DEFAULT_PASS=bandada -p 127.0.0.1:15706:5672 rabbitmq:4.2.9-management
corepack pnpm test:int            # IT_RABBITMQ_URL para otro puerto
docker rm -f ag-test-rmq
```

## Docker

```bash
cd ..   # bandadau-backend
docker build --build-context shared=../bandadau-shared -f services/admin-gateway/Dockerfile -t bandada/admin-gateway:local .
```

La imagen copia `schema/` (en Docker `bandadau-docs` no existe, por eso la copia local del SDL). Con `NODE_ENV=production`
la introspección y el landing page de Apollo se desactivan.

Reglas, arquitectura, contratos, variables y gotchas: **[`AGENTS.md`](AGENTS.md)**.
