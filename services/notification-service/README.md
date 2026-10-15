# notification-service

Notificaciones in-app, email y push de Bandada U (PHP 8.4 + Laravel 12, Clean Architecture, DynamoDB). Puerto **7007**.

## Quick start

```bash
cd ../../../bandadau-infra && make up            # usa esta carpeta como contexto de build
# o solo este servicio
cp .env.example .env
docker build -t bandada/notification-service:local .
docker run --rm --env-file .env -p 7007:7007 bandada/notification-service:local
docker run --rm --env-file .env bandada/notification-service:local php artisan notifications:consume
```

Servicios Compose: `notification-service` (web), `notification-worker` (`notifications:consume`), `notification-relay`
(`notifications:relay-outbox`, inactivo; opcional). Memoria sugerida 256 MB web / 128 MB worker. Usuario no root, HEALTHCHECK a `/health/ready`.
La tabla `bandada-notifications` (con `GSI1`) y `bandada-idempotency` las crea `bandadau-infra`; el servicio espera y reintenta.

## Pruebas

Ver `AGENTS.md`. Incluyen eventos reales por RabbitMQ, DynamoDB Local y correo real en Mailpit (duplicados, preferencias,
idioma es/en, agrupación de reacciones, DLQ).

## Endpoints

`GET /api/v1/notifications`, `POST /api/v1/notifications/{id}/read`, `POST /api/v1/notifications/read-all`,
`GET|PUT /api/v1/notifications/preferences`, `PUT|DELETE /api/v1/devices/{token}`, `POST /internal/v1/notifications`,
`/health/live`, `/health/ready`.
