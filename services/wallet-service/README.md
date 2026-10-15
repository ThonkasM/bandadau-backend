# wallet-service

Billetera de créditos de Bandada U (PHP 8.4 + Laravel 12, arquitectura hexagonal, PostgreSQL `wallet_db`). Puerto **7005**.

## Quick start

```bash
cd ../../../bandadau-infra && make up           # levanta todo (usa esta carpeta como contexto de build)
# o solo este servicio contra dependencias temporales
cp .env.example .env
docker build -t bandada/wallet-service:local .
docker run --rm --env-file .env -p 7005:7005 bandada/wallet-service:local            # web (migra al arrancar)
docker run --rm --env-file .env bandada/wallet-service:local php artisan wallet:consume-commands
docker run --rm --env-file .env bandada/wallet-service:local php artisan wallet:relay-outbox
```

Servicios Compose esperados: `wallet-service` (web), `wallet-worker`, `wallet-relay` (misma imagen, distinto comando).
Memoria sugerida: 256 MB web, 128 MB worker/relay. Usuario no root, HEALTHCHECK incluido (curl a `/health/ready`).

## Pruebas

Ver `AGENTS.md` (comandos). Cubren dominio, casos de uso (dobles en memoria), HTTP real, concurrencia con procesos paralelos,
y el flujo completo con RabbitMQ real (comando → débito → outbox → evento), duplicados, tombstone, reintentos y DLQ.

## Endpoints

| operationId | Ruta |
|---|---|
| getMyWallet | `GET /api/v1/wallet/me` |
| listMyLedgerEntries | `GET /api/v1/wallet/me/entries` |
| createTopUp | `POST /api/v1/wallet/topups` (Idempotency-Key) |
| getTopUp | `GET /api/v1/wallet/topups/{topUpId}` |
| simulateTopUpPayment | `POST /api/v1/wallet/topups/{topUpId}/simulate-payment` (solo simulador) |
| paymentWebhook | `POST /api/v1/wallet/webhooks/payment` (HMAC) |
| getCreditStats | `GET /internal/v1/stats/credits` |

Salud: `/health/live`, `/health/ready`. Detalles de variables, mensajería y decisiones: `AGENTS.md`.
