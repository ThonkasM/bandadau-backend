# AGENTS.md — wallet-service (S5)

Lee primero el `AGENTS.md` del workspace (`../../../AGENTS.md`), el del repo (`../../AGENTS.md`), `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`,
`bandadau-docs/docs/04-patrones-y-reglas/arquitectura-hexagonal.md` (el ejemplo `DebitCredits` es de este
servicio) y `bandadau-docs/docs/03-arquitectura/idempotencia.md`.

## Identidad

Billetera de **créditos** (enteros): saldo, libro mayor (`LedgerEntry`), recargas con pasarela
simulada y webhook firmado, y los pasos de débito/reembolso de la SAGA (C1). Es el caso
estrella de idempotencia (T8: doble clic en "pagar" = un solo cargo).

## Stack

PHP 8.4 · Laravel 12 · PostgreSQL 18 (`wallet_db`) · RabbitMQ (`php-amqplib`, verificar versión) ·
AWS SDK PHP (DynamoDB idempotencia) · OpenTelemetry PHP · Pest · Larastan nivel 8 · Pint · Deptrac.

## Arquitectura: Hexagonal

```
src/  (Bandada\Wallet\)
├── Domain/{Model,Event,Exception}
├── Application/{Port/In,Port/Out,UseCase}
└── Adapter/{In/Http,In/Messaging,Out/Persistence,Out/Messaging,Out/External}
app/Providers/WalletServiceProvider.php (bind puertos)   app/Console/Commands/
routes/api.php   database/migrations/   lang/{es,en}/problems.php   tests/   deptrac.yaml
```

## Comandos (propuestos)

```bash
composer install
php artisan serve --port=7005                 # API (en Docker: php-fpm/FrankenPHP según infra)
php artisan wallet:consume-commands           # worker de comandos SAGA
php artisan wallet:relay-outbox               # relay outbox → RabbitMQ
php artisan migrate
./vendor/bin/pest                             # unit + integración
./vendor/bin/pint --test && ./vendor/bin/phpstan analyse && ./vendor/bin/deptrac analyse
```

## Variables de entorno (`.env.example`)

```
APP_ENV=local
APP_KEY=
APP_PORT=7005
APP_LOCALE=es
APP_FALLBACK_LOCALE=es
DB_CONNECTION=pgsql
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=wallet_db
DB_USERNAME=wallet
DB_PASSWORD=change-me
RABBITMQ_URL=amqp://bandada:bandada@localhost:5672
JWKS_URL=http://localhost:7001/.well-known/jwks.json
JWT_ISSUER=http://api.bandada.localhost
PAYMENT_WEBHOOK_SECRET=change-me            # HMAC del webhook
PAYMENT_CHECKOUT_BASE_URL=http://app.bandada.localhost/wallet/checkout
SIMULATE_PAYMENT_ENABLED=true               # false en producción
TOPUP_PACKAGES=CREDITS_20,CREDITS_50,CREDITS_100   # RF-19
CHAOS_WALLET_DELAY_MS=0
IDEMPOTENCY_TABLE=bandada-idempotency
DYNAMODB_ENDPOINT=http://localhost:8000
AWS_DEFAULT_REGION=us-east-1
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=wallet-service
```

## Puertos y rutas

Dev **7005**. Público `/api/v1/wallet/**` (incluye `/wallet/webhooks/payment` sin JWT).
Interno `/internal/v1/stats/credits`.

## Contratos

`bandadau-docs/contracts/openapi/wallet-service.yaml`: `getMyWallet`, `listMyLedgerEntries`, `createTopUp` ♻️,
`simulatePayment` (dev/demo), `paymentWebhook` (HMAC, idempotente por `gatewayRef`), `getCreditStats`.

## Mensajería

- **Consume** (`wallet-service.commands`, binding `bandada.wallet.cmd.#`):
  `bandada.wallet.cmd.debit-credits.v1`, `bandada.wallet.cmd.refund-credits.v1`.
- **Publica**: `bandada.wallet.credits-debited.v1`, `…credits-debit-failed.v1`
  (`INSUFFICIENT_FUNDS`, `WALLET_NOT_FOUND`), `…credits-refunded.v1`, `bandada.wallet.topup.paid.v1`.
- Consume `bandada.identity.user.registered.v1` **solo si** se decide crear la billetera al registrarse
  (propuesta; si no, se crea perezosamente en el primer `getMyWallet`/recarga — documentar en el UC).

## Datos (`wallet_db`)

`wallets` (`user_id` único, `balance_credits BIGINT CHECK >= 0`, `version`), `ledger_entries`
(`operation_ref` **único**, `type`, `amount_credits BIGINT`), `top_ups` (`gateway_ref` único),
`outbox`, `processed_messages`.

## Reglas específicas y gotchas

- Créditos **siempre enteros** (`int`/`BIGINT`); prohibido `float`/`decimal`.
- `operationRef`: `DEBIT:<registrationId>`, `REFUND:<registrationId>`, `TOPUP:<topUpId>`. Reembolso solo si
  existe el débito correspondiente y no existe ya el reembolso.
- Débito con `SELECT … FOR UPDATE` o bloqueo optimista por `version`; nunca leer-modificar-escribir sin bloqueo.
- Inbox + efecto + outbox en **una** transacción (`TransactionManager::run`).
- Webhook: verificar firma HMAC en tiempo constante; repetir → **200** sin efecto.
- `simulate-payment` deshabilitado si `SIMULATE_PAYMENT_ENABLED=false`.
- Facades de Laravel (`DB::`, `Log::`) solo en adaptadores/`app/`; Deptrac lo vigila.
- Problem Details localizados por `Accept-Language` (`lang/{es,en}`), `code` estable
  (`INSUFFICIENT_FUNDS`, `TOPUP_NOT_FOUND`, `INVALID_SIGNATURE`, `IDEMPOTENCY_*`).

## Casos de uso

UC-12 (débito SAGA), UC-13 (reembolso), UC-15 (recargar créditos), UC-16 (consultar movimientos);
fuente de `get_credit_stats` (UC-19/UC-22).

## Definición de hecho

`definition-of-done.md` §0, §2, §3 + Deptrac + batería de idempotencia (topup doble clic, webhook
repetido, comando duplicado) + prueba de saldo nunca negativo con débitos concurrentes.
