# AGENTS.md — events-service (S4)

Lee primero el `AGENTS.md` del workspace (`../../../AGENTS.md`), el del repo (`../../AGENTS.md`), `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`,
`bandadau-docs/docs/03-arquitectura/decisiones-clave.md` (D2), `bandadau-docs/docs/03-arquitectura/saga-inscripcion-evento.md`
y `bandadau-docs/docs/04-patrones-y-reglas/ddd.md` (diseño completo de este servicio).

## Identidad

Eventos y talleres universitarios e inscripciones con cupo y precio en créditos.
**Orquestador de la SAGA** (C1): `events-service` (Java/Postgres) → `wallet-service`
(PHP/Postgres) → `ticketing-service` (TS/DynamoDB), con compensaciones y timeouts.

## Stack

Java 25 · Spring Boot 4 (Web MVC, Data JPA, AMQP, Security resource server, Actuator,
Scheduling) · Gradle Kotlin DSL · PostgreSQL 18 (`events_db`) · Flyway · RabbitMQ ·
OpenTelemetry · JUnit 5 + Testcontainers + ArchUnit + Awaitility. Verificar APIs de Spring Boot 4 / Spring AMQP.

## Arquitectura: DDD táctico

```
src/main/java/com/bandadau/events/
├── domain/{shared,event,registration,saga}      ← agregados Event, Registration, SagaInstance; VO Capacity, Credits, EventSchedule
├── application/{event,registration,saga,port}   ← RegisterToEventService, RegistrationSagaOrchestrator, SagaTimeoutScheduler
├── infrastructure/{persistence,messaging,idempotency,config}
└── interfaces/{rest,internal}
src/main/resources/{application.yml, db/migration, messages_es.properties, messages_en.properties}
```

## Comandos (propuestos)

```bash
./gradlew bootRun                     # :7004
./gradlew test                        # unit + integración + ArchUnit
./gradlew test --tests '*saga*'       # suite de SAGA (S1–S10 de testing-strategy.md §6, nivel servicio)
./gradlew spotlessCheck checkstyleMain build
```

## Variables de entorno (`.env.example`)

```
PORT=7004
DATABASE_URL=jdbc:postgresql://localhost:5432/events_db
DATABASE_USER=events
DATABASE_PASSWORD=change-me
RABBITMQ_URL=amqp://bandada:bandada@localhost:5672
JWKS_URL=http://localhost:7001/.well-known/jwks.json
JWT_ISSUER=http://api.bandada.localhost
MEDIA_SERVICE_URL=http://localhost:7003
SERVICE_CLIENT_ID=events-service
SERVICE_CLIENT_SECRET=change-me
SAGA_STEP_TIMEOUT=PT30S
SAGA_SCHEDULER_INTERVAL=PT5S
SAGA_COMMAND_MAX_RETRIES=3
OUTBOX_RELAY_INTERVAL=PT1S
IDEMPOTENCY_TABLE=bandada-idempotency
DYNAMODB_ENDPOINT=http://localhost:8000
AWS_REGION=us-east-1
DEFAULT_LOCALE=es
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=events-service
```

## Puertos y rutas

Dev **7004**. Público `/api/v1/events/**`, `/api/v1/registrations/**`. Interno
`/internal/v1/sagas` (`listSagas`), `/internal/v1/stats/registrations` (`getRegistrationStats`).

## Contratos

`bandadau-docs/contracts/openapi/events-service.yaml`: `createEvent` ♻️ (ORGANIZER), `publishEvent`,
`listEvents` (`public=true` para la landing, sin JWT), `getEvent`, `registerToEvent` ♻️ (**202**),
`getRegistration`, `listMyRegistrations`, `cancelRegistration` ♻️ (**202**), internos.

## Mensajería

- **Publica comandos** (`bandada.commands`): `bandada.wallet.cmd.debit-credits.v1`,
  `bandada.wallet.cmd.refund-credits.v1`, `bandada.ticketing.cmd.issue-ticket.v1`,
  `bandada.ticketing.cmd.void-ticket.v1` (con `sagaId`, `registrationId`, `idempotencyKey = <sagaId>:<step>`).
- **Publica eventos**: `bandada.events.event.published|cancelled.v1`,
  `bandada.events.registration.confirmed|failed|cancelled.v1`.
- **Consume** (`events-service.saga-replies`): `bandada.wallet.credits-debited|credits-debit-failed|credits-refunded.v1`,
  `bandada.ticketing.ticket-issued|ticket-issue-failed|ticket-voided.v1`.

## Datos (`events_db`)

`events` (`version` para bloqueo optimista, `CHECK seats_taken <= capacity`), `registrations`
(índice parcial único `(event_id, user_id) WHERE status IN ('PENDING','CONFIRMED')`),
`saga_instances` (`type`, `step`, `status`, `deadline_at`, `attempts`), `outbox`, `processed_messages`.

## Reglas específicas y gotchas

- Paso 1 (reservar cupo + `Registration PENDING` + `SagaInstance STARTED` + comando en outbox) es
  **una sola transacción local**; excepción documentada en `ddd.md`.
- Precio 0 → se salta el débito (`STARTED → AWAITING_TICKET`).
- Respuestas tardías/duplicadas a una SAGA terminada se **ignoran** (invariante I8); si un débito llega
  tarde tras compensar, se emite `refund-credits`.
- Nunca consultar saldo ni tickets por HTTP para decidir: se decide con las respuestas de la SAGA.
- Chaos flags (`CHAOS_TICKETING_FAIL`, `CHAOS_WALLET_DELAY_MS`) viven en ticketing/wallet, no aquí;
  aquí solo se configura el timeout.
- Problem Details localizados (`es` por defecto) con `code` estable: `EVENT_FULL`, `ALREADY_REGISTERED`,
  `EVENT_NOT_OPEN`, `CONCURRENT_MODIFICATION`, `REGISTRATION_NOT_CANCELLABLE`. `failureReason` de la
  inscripción también es un código (lo traduce el cliente).
- Fechas en UTC; la UI formatea en `America/La_Paz`.

## Casos de uso

UC-11 (publicar evento), UC-12 (inscribirse — SAGA), UC-13 (cancelar — SAGA inversa); fuente de datos
de UC-19/UC-20/UC-22 (estadísticas y SAGAs fallidas) y UC-23 (recordatorios n8n).

## Definición de hecho

`definition-of-done.md` §0, §2, §3 + ArchUnit + suite SAGA con fallos inyectados en verde + prueba de
concurrencia de cupo (N inscripciones, cupo C → exactamente C).
