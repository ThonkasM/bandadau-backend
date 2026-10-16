# AGENTS.md — wallet-service (S5)

Lee primero `../../../AGENTS.md`, `../../AGENTS.md`, `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`,
`bandadau-docs/docs/04-patrones-y-reglas/arquitectura-hexagonal.md`, `idempotencia.md` y
`bandadau-docs/docs/06-plan/fase-1-alcance-y-contrato-local.md` (normativo para la fase 1).

## Identidad

Billetera de **créditos enteros**: saldo, libro mayor (`ledger_entries`), recargas con pasarela simulada y
webhook firmado, y los pasos de débito/reembolso de la SAGA de inscripción. Invariantes: saldo ≥ 0,
saldo = suma del ledger, `operation_ref` único (`TOPUP:<id>`, `DEBIT:<registrationId>`, `REFUND:<registrationId>`).

## Stack

PHP 8.4 · Laravel 12.70 (solo composition root) · PostgreSQL `wallet_db` · RabbitMQ (`php-amqplib` 3.7) ·
DynamoDB (`aws/aws-sdk-php`, tabla `bandada-idempotency`) · `firebase/php-jwt` 7 · Pest 4 · Larastan 3 (nivel 8) · Deptrac 4 · Pint.

## Arquitectura: Hexagonal

```
src/ (Bandada\Wallet\)
├── Domain/{Model,Event,Exception}               Wallet, Credits, OperationRef, LedgerEntry, TopUp, ...
├── Application/{Port/In,Port/Out,UseCase}       *UseCase + *Service; inbox/transacción dentro del caso de uso
└── Adapter/{In/Http,In/Messaging,Out/Persistence,Out/Messaging,Out/External,Shared}
app/{Providers/WalletServiceProvider,Console/Commands,Logging,Support}   routes/api.php   lang/{es,en}   deptrac.yaml
```

`Adapter/Shared` = contratos técnicos comunes a adaptadores de entrada y salida (idempotency store, AMQP, CloudEvent,
log context). Persistencia con Query Builder (sin modelos Eloquent). Deptrac falla el build ante cualquier violación.

## Comandos

```bash
# Todo en Docker (no hay PHP local)
docker compose -f docker-compose.test.yml up -d --wait db mq dynamo        # Postgres:15501 RabbitMQ:15601 Dynamo:15701
docker compose -f docker-compose.test.yml run --rm tests vendor/bin/pest   # unitarias + integración (99 pruebas)
docker compose -f docker-compose.test.yml run --rm tests sh -c "vendor/bin/pint --test && vendor/bin/phpstan analyse --memory-limit=512M && vendor/bin/deptrac analyse --fail-on-uncovered"
docker compose -f docker-compose.test.yml down -v
docker build -t bandada/wallet-service:local .
```

Roles de la imagen (misma imagen): `web` (por defecto; migra y levanta nginx+php-fpm :7005), `worker`
(`php artisan wallet:consume-commands`, alias `bandada:consume`), `relay` (`php artisan wallet:relay-outbox`, alias
`bandada:relay`: outbox→RabbitMQ + expiración de recargas + purga). Otros: `bandada:check-env`, `bandada:declare-topology`
(solo dev/tests), `wallet:expire-topups`.

## Variables (ver `.env.example`)

`DB_*`, `RABBITMQ_URL`, `RABBITMQ_DECLARE_TOPOLOGY` (false; true solo dev/tests), `JWKS_URL`, `JWT_ISSUER`,
`PAYMENT_WEBHOOK_SECRET` (≥16 car.), `PAYMENT_SIMULATOR_ENABLED`, `PAYMENT_GATEWAY_MODE` (`simulate`|`unavailable`; D-14: en `unavailable`, `createTopUp` y `simulateTopUpPayment` responden 503 `PAYMENT_GATEWAY_UNAVAILABLE` con `Retry-After: 30` y no se persiste nada; también `outcome: UNAVAILABLE` en `simulate-payment` da el 503 dejando la recarga PENDING; prohibido en producción), `PAYMENT_CHECKOUT_BASE_URL`, `TOPUP_PACKAGES`,
`TOPUP_TTL_MINUTES`, `IDEMPOTENCY_TABLE`, `DYNAMODB_ENDPOINT`, `AWS_*`, `CORS_ORIGINS`, `CHAOS_WALLET_DELAY_MS`
(debe ser 0 en producción), `LOG_CHANNEL` (`stdout` | `stderr`). El arranque valida el entorno y falla rápido.

## Endpoints

Implementados: `getMyWallet`, `listMyLedgerEntries`, `createTopUp` (Idempotency-Key), `getTopUp`, `simulateTopUpPayment`
(404 si `PAYMENT_SIMULATOR_ENABLED=false`; `outcome` `PAID`|`FAILED`|`UNAVAILABLE`), `paymentWebhook` (HMAC `X-Signature: sha256=<hex>`, ventana anti-replay 5 min sobre
`occurredAt`, 200 + `duplicate:true` en repetidos), `getCreditStats` (`/internal/v1/stats/credits`, token de servicio `internal:read`), `getTopSpenders` (`/internal/v1/stats/top-spenders`: ranking por débitos − reembolsos, `internal:read`; MCP `get_top_credit_spenders`),
`/health/live`, `/health/ready` (Postgres, RabbitMQ, DynamoDB). Diferido: limitación de tasa por usuario (429), exportador OTLP
(solo se propaga `traceparent`).

## Mensajería

- Consume `wallet-service.commands` (`bandada.wallet.cmd.#`): `debit-credits.v1`, `refund-credits.v1`. Ack manual tras commit,
  reintentos 5s/30s/5m (máx. 3) y DLQ; mensajes inválidos/desconocidos → DLQ directo.
- Publica por outbox + relay (`bandada.events`): `credits-debited`, `credits-debit-failed` (`INSUFFICIENT_FUNDS`,
  `WALLET_NOT_FOUND`, `SAGA_ABORTED`), `credits-refunded` (con `amountCredits: 0` = tombstone), `topup.paid`.
  Las respuestas incluyen `idempotencyKey` (eco del comando) y extensiones `sagaid`, `correlationid`, `causationid`, `traceparent`.
- Un reenvío del orquestador (otro `id`, misma operación) **re-publica** la respuesta original.
- El relay usa `mandatory`: un mensaje sin cola enlazada es error de configuración (se reintenta, no se descarta).

## Decisiones / divergencias

- Tombstone = fila `REFUND` de monto 0 (CHECK permite 0 solo para REFUND); se oculta en listados y estadísticas.
- `IDEMPOTENCY_KEY_REQUIRED` (400) / `IDEMPOTENCY_KEY_INVALID` según `api-rest-guidelines.md` y `testing-strategy.md`.
- Webhook con `topUpId` desconocido responde 404 `TOPUP_NOT_FOUND` (contrato OpenAPI), no 200 como sugiere UC-15.
- Variable del simulador: `PAYMENT_SIMULATOR_ENABLED` (fase 1) en vez de `SIMULATE_PAYMENT_ENABLED`.
