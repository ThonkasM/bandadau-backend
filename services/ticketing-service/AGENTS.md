# AGENTS.md — ticketing-service (S6)

Lee primero el `AGENTS.md` del workspace (`../../../AGENTS.md`), el del repo (`../../AGENTS.md`), `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`,
`bandadau-docs/docs/03-arquitectura/decisiones-clave.md` (D2, D3) y `bandadau-docs/docs/04-patrones-y-reglas/clean-architecture.md`.

## Identidad

Entradas (tickets) y comprobantes de eventos: emite el ticket con **QR firmado** como paso 3
de la SAGA (C1), lo anula como compensación y lo valida en la puerta (UC-14). Tercer
lenguaje/motor de la SAGA (TypeScript + DynamoDB).

## Stack

TypeScript · NestJS 11 · Node 24 · DynamoDB (`bandada-ticketing`; DynamoDB Local en dev) con
`@aws-sdk/client-dynamodb` + `lib-dynamodb` · RabbitMQ (`@bandada/messaging-ts`) · `@bandada/*` ·
Jest/Vitest + Testcontainers (DynamoDB Local, RabbitMQ) · dependency-cruiser.

## Arquitectura: Clean Architecture

```
src/
├── entities/            ticket.entity.ts, ticket-status.ts, qr-payload.ts (VO), errors/
├── use-cases/           ports/ (ticket.repository, qr-signer, event-publisher, clock, id-generator,
│                        organizer-directory), issue-ticket/, void-ticket/, validate-ticket/,
│                        list-my-tickets/, get-ticket/
├── interface-adapters/  controllers/{http/tickets.controller.ts, messaging/ticketing-commands.consumer.ts},
│                        presenters/, gateways/{dynamo/dynamo-ticket.repository.ts, dynamo-outbox.publisher.ts,
│                        crypto/hmac-qr-signer.gateway.ts, http/events-organizer.gateway.ts}
└── frameworks-drivers/  main.ts, modules/, config/, messaging/ (relay del outbox), observability/
locales/{es,en}/errors.json   test/
```

## Comandos (propuestos)

```bash
pnpm --filter ticketing-service dev        # :7006
pnpm --filter ticketing-service consumer   # consumidor de comandos (o mismo proceso, según infra)
pnpm --filter ticketing-service test | test:int | test:e2e | lint | typecheck | arch | build
```

## Variables de entorno (`.env.example`)

```
PORT=7006
DYNAMODB_ENDPOINT=http://localhost:8000
AWS_REGION=us-east-1
TICKETING_TABLE=bandada-ticketing
IDEMPOTENCY_TABLE=bandada-idempotency
RABBITMQ_URL=amqp://bandada:bandada@localhost:5672
JWKS_URL=http://localhost:7001/.well-known/jwks.json
JWT_ISSUER=http://api.bandada.localhost
EVENTS_SERVICE_URL=http://localhost:7004
SERVICE_CLIENT_ID=ticketing-service
SERVICE_CLIENT_SECRET=change-me
QR_SIGNING_KEY_PATH=/run/secrets/qr-es256.pem   # PEM P-256 (ES256); generar con `make keys`
QR_SIGNING_KID=tk-2026-10
QR_KEY_ID=dev-1
CHAOS_TICKETING_FAIL=false
DEFAULT_LOCALE=es
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=ticketing-service
```

## Puertos y rutas

Dev **7006**. Público `/api/v1/tickets/**`. Sin endpoints internos por ahora.

## Contratos

`bandadau-docs/contracts/openapi/ticketing-service.yaml`: `listMyTickets`, `getTicket` (incluye `qrPayload`),
`validateTicket` ♻️ (rol ORGANIZER **del evento**).

## Mensajería

- **Consume** (`ticketing-service.commands`, `bandada.ticketing.cmd.#`):
  `bandada.ticketing.cmd.issue-ticket.v1`, `bandada.ticketing.cmd.void-ticket.v1`.
- **Publica**: `bandada.ticketing.ticket-issued.v1`, `…ticket-issue-failed.v1`, `…ticket-voided.v1`,
  `bandada.ticketing.ticket.used.v1`.

## Datos (DynamoDB `bandada-ticketing`)

`pk = TICKET#<ticketId>` / `sk = META`; GSI1 `USER#<userId>` / `EVENT#<eventId>`;
GSI2 `REG#<registrationId>`. Inbox como ítem `pk = INBOX#<messageId>` / `sk = META` (TTL 14 días) con
`attribute_not_exists(pk)` y outbox como ítems `pk = OUTBOX#<id>` escritos en el mismo
`TransactWriteItems` que el ticket (propuesta; alternativa: DynamoDB Streams → relay).

## Reglas específicas y gotchas

- **Un ticket por `registrationId`**: ítem centinela `pk = REG#<registrationId>` con condición
  `attribute_not_exists` dentro de la transacción; reemitir devuelve el ticket existente y publica
  `ticket-issued` de nuevo (respuesta idempotente).
- `void-ticket` sobre ticket inexistente → igual responde `ticket-voided` (compensación idempotente).
- Estados finales: `USED` y `VOIDED` no cambian (invariante 5); validar dos veces → `409 TICKET_ALREADY_USED`.
- QR = **JWS compacto ES256** (`kid` en el header; payload `tid`, `eid`, `uid`, `iat`), verificable offline
  por el portero con la clave pública. Nunca datos personales en el QR (ver UC-14).
- Validación: el usuario debe ser organizador del evento (consulta `events-service` con token de servicio,
  caché corta) — o usar claim si se añade al contrato.
- `CHAOS_TICKETING_FAIL=true` hace fallar **toda** emisión con `ticket-issue-failed` (demo C1). Nunca activo en prod.
- `TransactWriteItems` máximo de ítems y tamaño: verificar límites actuales de DynamoDB.
- Problem Details localizados por `Accept-Language`, `code` estable (`TICKET_NOT_FOUND`, `INVALID_QR_SIGNATURE`, `TICKET_EVENT_MISMATCH`,
  `TICKET_ALREADY_USED`, `TICKET_VOIDED`, `NOT_EVENT_ORGANIZER`).

## Casos de uso

UC-12 (emitir ticket), UC-13 (anular), UC-14 (validar entrada en la puerta).

## Definición de hecho

`definition-of-done.md` §0, §2, §3 + pruebas: emisión duplicada, anulación de inexistente, doble
validación, QR manipulado, `CHAOS_TICKETING_FAIL`.
