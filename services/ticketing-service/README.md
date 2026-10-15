# ticketing-service

Entradas con QR firmado: emisión y anulación como paso 3 de la SAGA y validación en la puerta.

| | |
|---|---|
| Stack | TypeScript + NestJS 11 · DynamoDB (`bandada-ticketing`) · Clean Architecture |
| Puerto dev | 7006 |
| Rutas / dominio | `/api/v1/tickets` (`/me`, `/signing-keys`, `/{ticketId}`, `/validate`), `/health/live`, `/health/ready` |
| Casos de uso | UC-12, UC-13, UC-14 |
| Estado | Fase 1 implementada y probada (35 unitarias + 16 de integración) |

## Proyecto independiente

No hay workspace en la raíz: este servicio tiene su `package.json`, `pnpm-lock.yaml` y `Dockerfile`, y consume
`@bandada/*` desde `../../../bandadau-shared/packages/<pkg>` (compílalo antes).

```bash
(cd ../../../bandadau-shared && corepack pnpm install --frozen-lockfile && corepack pnpm build)
corepack pnpm install
cp .env.example .env              # QR_SIGNING_KEY_PATH apunta a bandadau-infra/secrets/qr-es256.pem
corepack pnpm dev                 # :7006 (requiere `make infra-up`)

corepack pnpm test                # unitarias (Jest + SWC)
corepack pnpm test:int            # integración: DynamoDB Local + RabbitMQ reales (ver abajo)
corepack pnpm lint && corepack pnpm typecheck && corepack pnpm arch   # ESLint, tsc, dependency-cruiser
corepack pnpm build && corepack pnpm start
```

### Pruebas de integración

Usan un broker y un DynamoDB **propios** (no los de la infra compartida, porque publicar respuestas en
`bandada.events` llenaría `events-service.saga-replies`):

```bash
docker run -d --name tk-test-dynamo -m 384m -p 127.0.0.1:18006:8000 amazon/dynamodb-local:3.3.1 -jar DynamoDBLocal.jar -inMemory -sharedDb
docker run -d --name tk-test-rmq -m 512m -e RABBITMQ_DEFAULT_USER=bandada -e RABBITMQ_DEFAULT_PASS=bandada -p 127.0.0.1:15706:5672 rabbitmq:4.2.9-management
corepack pnpm test:int            # IT_DYNAMODB_ENDPOINT / IT_RABBITMQ_URL por si usas otros puertos
docker rm -f tk-test-dynamo tk-test-rmq
```

Cubren: emisión idempotente por redelivery (inbox) y por registro (centinela), carrera de validaciones (solo una gana),
`void` antes de `issue` (ALREADY_VOIDED), `void` de ticket usado, QR verificable con la clave pública y rechazado si se altera,
ventana de validación, autorización por organizador, idempotencia HTTP (`Idempotent-Replayed`), paginación y
`CHAOS_TICKETING_FAIL`. `test/live-flow.cjs` es un chequeo manual contra la infra viva.

## Docker

```bash
cd ..   # bandadau-backend
docker build --build-context shared=../bandadau-shared -f services/ticketing-service/Dockerfile -t bandada/ticketing-service:local .
```

Imagen `node:24-slim`, usuario `node`, `HEALTHCHECK` con `wget` a `/health/ready`. El par ES256 se monta en
`/run/secrets/qr-es256.pem` (compose de `bandadau-infra`).

Reglas, arquitectura, contratos, colas y gotchas: **[`AGENTS.md`](AGENTS.md)**.
Fuente de verdad del sistema: `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`.
