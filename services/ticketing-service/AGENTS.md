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

## Arquitectura: Clean Architecture (implementada)

```
src/
├── entities/            ticket.entity.ts, ticket-status.ts, qr-claims.ts, validation-window.policy.ts, errors/domain-errors.ts
├── use-cases/           messages.ts (mensajes de respuesta), ports/{ticket.repository,qr-signer,event-publisher,clock,
│                        id-generator,transaction}.ts, issue-ticket/, void-ticket/, validate-ticket/, list-my-tickets/,
│                        get-ticket/, get-signing-keys/
├── interface-adapters/  controllers/http/{tickets.controller,problem.filter,http-problem}.ts,
│                        controllers/messaging/ticketing-commands.consumer.ts,
│                        presenters/{ticket,problem}.presenter.ts + problem-messages.ts (es/en),
│                        gateways/dynamo/{dynamo-ticket.repository,dynamo-outbox.publisher}.ts, gateways/crypto/jose-qr-signer.gateway.ts
└── frameworks-drivers/  main.ts, bootstrap.ts, config/app-config.ts, modules/app.module.ts, health/health.controller.ts
test/{unit,integration,support}   .dependency-cruiser.cjs (pnpm arch)
```

`entities` y `use-cases` no importan frameworks (ni `@bandada/*`); el `TransactionContext` es un handle opaco que el inbox
entrega al caso de uso y que el repositorio traduce a `DynamoTransaction`. Los mensajes de error localizados viven en
`problem-messages.ts` (no hay carpeta `locales/`).

## Comandos

Proyecto independiente (sin workspace). Ver `README.md`.

```bash
corepack pnpm dev | build | start | test | test:int | lint | typecheck | arch
docker build --build-context shared=../bandadau-shared -f services/ticketing-service/Dockerfile -t bandada/ticketing-service:local .   # desde bandadau-backend
```

## Variables de entorno (`.env.example` completo)

`PORT`, `NODE_ENV`, `DYNAMODB_ENDPOINT`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `TICKETING_TABLE`,
`IDEMPOTENCY_TABLE`, `RABBITMQ_URL`, `JWKS_URL`, `JWT_ISSUER`, `CORS_ORIGINS`, `QR_SIGNING_KEY_PATH`, `QR_SIGNING_KID`
(header `kid` del QR), `QR_PREVIOUS_JWKS_PATH` (claves públicas rotadas, opcional), `CHAOS_TICKETING_FAIL` (se lee al arrancar),
`STRICT_ORGANIZER_CHECK` (true por defecto), `VALIDATION_OPENS_BEFORE_MINUTES` (120), `VALIDATION_DEFAULT_DURATION_MINUTES` (720),
`OUTBOX_RELAY_INTERVAL_MS` (500), `TICKETING_COMMANDS_QUEUE` (solo pruebas). `QR_KEY_ID`, `EVENTS_SERVICE_URL`,
`SERVICE_CLIENT_ID/SECRET` del compose no se usan (no se llama a events-service: la autorización sale del comando).

## Puertos, rutas, contrato

Dev **7006**. `/api/v1/tickets/me` (listMyTickets), `/api/v1/tickets/signing-keys` (getTicketSigningKeys, JWKS ES256,
`Cache-Control: public, max-age=3600`), `/api/v1/tickets/{id}` (getTicket con `qrPayload`; dueño o ADMIN),
`POST /api/v1/tickets/validate` (♻️ `@Idempotent()`, `ORGANIZER`/`ADMIN`), `/health/live`, `/health/ready` (DescribeTable).
Sin endpoints internos.

## Mensajería

- **Consume** cola `ticketing-service.commands` (creada por infra; el servicio solo la verifica): `bandada.ticketing.cmd.issue-ticket.v1`,
  `bandada.ticketing.cmd.void-ticket.v1`. Reintentos 5 s/30 s/5 min y DLQ los gestiona `@bandada/messaging-ts`.
- **Publica** (outbox + relay, `bandada.events`): `ticket-issued`, `ticket-issue-failed` (`CHAOS_INJECTED`, `ALREADY_VOIDED`),
  `ticket-voided` (`ticketId: null` si no había ticket), `ticket-void-failed` (`TICKET_ALREADY_USED`), `ticket.used`.

## Datos (DynamoDB `bandada-ticketing`)

| Ítem | pk / sk | Notas |
|---|---|---|
| Ticket | `TICKET#<id>` / `META` | `gsi1pk=USER#<userId>`, `gsi1sk=STARTS#<eventStartsAt ISO>#<id>` (orden por fecha del evento), `gsi2pk=REG#<registrationId>`, `gsi2sk=TICKET#<id>`; `organizerId`, `staffUserIds` |
| Centinela de inscripción | `REG#<registrationId>` / `LOCK` | `state` `ISSUED` + `ticketId`, o `VOIDED` (con `ticketId` nulo = tombstone de void previo) |
| Inbox | `INBOX#<messageId>` / `META` | TTL `expiresAt` (14 días), en la misma `TransactWriteItems` |
| Outbox | `OUTBOX#<id>` / `META` | `gsi1pk=OUTBOX#PENDING`; relay en el mismo proceso |

Emisión: `TransactWriteItems` = inbox + centinela (`attribute_not_exists`) + ticket + outbox. Validación: update condicional
`status = ISSUED AND eventId = :eid` + outbox; ante `TransactionConflict`/condición perdida se relee y se decide (máx. 3 intentos).

## Reglas específicas y gotchas

- Un ticket por `registrationId`; reemitir (mensaje nuevo, misma inscripción) responde de nuevo `ticket-issued` con el mismo ticket.
- `void` antes de `issue` deja tombstone → el `issue` tardío responde `ticket-issue-failed` `ALREADY_VOIDED`.
- `USED` y `VOIDED` son finales; `void-ticket` sobre `USED` → `ticket-void-failed`.
- QR = JWS compacto ES256 (`{alg, kid}`; claims `tid, eid, rid, sub, iat` con `iat` = emisión, así el QR es estable). Clave PEM PKCS#8 en
  `QR_SIGNING_KEY_PATH`; JWKS público = clave activa + `QR_PREVIOUS_JWKS_PATH`. Nunca datos personales en el QR.
- Validación: `ORGANIZER` del evento (`organizerId`/`staffUserIds` copiados del comando) o `ADMIN`; ventana `startsAt − 2 h … fin`
  (si no hay fin, `startsAt + 12 h`); orden de errores: firma (422) → evento (422) → 404 → 403 → 409 (usado/anulado) → ventana (422).
- El comando `issue-ticket` trae `organizerId`, `staffUserIds` y `eventEndsAt` (events-service los envía desde el snapshot de la SAGA; se persisten en el ticket).
  `STRICT_ORGANIZER_CHECK` es `true` por defecto: un ticket sin datos de organizador (emitido antes de este cambio) solo lo valida un `ADMIN`; con `false` (legado) cualquier `ORGANIZER` puede.
- `VALIDATION_WINDOW_CLOSED` no está en `@bandada/i18n/errors` ni en el OpenAPI (sí en UC-14/PROPUESTA 5): el texto es local.
- Un `ConcurrentTransitionError` dentro del consumidor se reintenta por la cola de espera (5 s), no se pierde.
- `CHAOS_TICKETING_FAIL=true` hace fallar **toda** emisión con `ticket-issue-failed`. Nunca en producción.
- Jest transpila con SWC porque `jose` 6 es solo ESM (`transformIgnorePatterns` en `jest.base.cjs`).

## Casos de uso

UC-12 (emitir ticket), UC-13 (anular), UC-14 (validar entrada en la puerta).

## Definición de hecho

`definition-of-done.md` §0, §2, §3 + pruebas: emisión duplicada, anulación de inexistente, doble
validación, QR manipulado, `CHAOS_TICKETING_FAIL`.
