# AGENTS.md — events-service (S4)

Lee primero el `AGENTS.md` del workspace (`../../../AGENTS.md`), el del repo (`../../AGENTS.md`), `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`,
`bandadau-docs/docs/03-arquitectura/decisiones-clave.md` (D2), `bandadau-docs/docs/03-arquitectura/saga-inscripcion-evento.md`
y `bandadau-docs/docs/04-patrones-y-reglas/ddd.md` (diseño completo de este servicio).

## Identidad

Eventos y talleres universitarios e inscripciones con cupo y precio en créditos.
**Orquestador de la SAGA** (C1): `events-service` (Java/Postgres) → `wallet-service`
(PHP/Postgres) → `ticketing-service` (TS/DynamoDB), con compensaciones y timeouts.

## Stack

Java 25 · Spring Boot 4.0.8 (Web MVC, **Spring JDBC `JdbcClient`**, AMQP, Security resource server, Actuator,
Scheduling, Resilience4j circuit breaker) · Gradle Kotlin DSL · PostgreSQL 18 (`events_db`) · Flyway · RabbitMQ ·
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

## Comandos (verificados, todo en Docker)

```bash
make test-unit      # dominio + tabla de transiciones SagaInstance + ArchUnit
make test-java      # + integración Testcontainers: S1-S6, S9, S10, idempotencia, cover, internos (wallet/ticketing simulados en test)
make image
python3 scripts/simulate-participants.py   # wallet+ticketing de desarrollo vía API de management de RabbitMQ
python3 scripts/smoke-e2e.py               # identity -> events -> saga completa
```

Variables: `.env.example`. Idempotencia HTTP en Postgres (`idempotency_keys`, mismo contrato HTTP de D3). Persistencia JDBC explícita
(`SELECT ... FOR UPDATE` del evento serializa reservas de cupo; versión optimista + `CHECK` además).

## Puertos y rutas

Dev **7004**. Público `/api/v1/events/**`, `/api/v1/registrations/**`. Interno
`/internal/v1/sagas` (`listSagas`), `/internal/v1/stats/registrations` (`getRegistrationStats`).

## Contratos

`bandadau-docs/contracts/openapi/events-service.yaml`: `createEvent` ♻️ (ORGANIZER), `publishEvent`,
`listEvents` (`public=true` para la landing, sin JWT), `getEvent`, `registerToEvent` ♻️ (**202**),
`getRegistration`, `listMyRegistrations`, `cancelRegistration` ♻️ (**202**), internos.

## Decisiones de la fase 1

- Saga exacta de D2/D15: paso 1 local (cupo + Registration PENDING + SagaInstance + comando en outbox); reenvíos de comandos a 5/10/20 s dentro de la ventana de 30 s; vencida → compensación
  (timeout débito → `refund-credits` tombstone; timeout ticket → `void-ticket` → `refund-credits`); **compensaciones reintentadas sin límite** (backoff 5 s ×2, tope 60 s) con alerta a los 2 min
  (log `event=saga.compensation.stuck` + métrica); `retrySaga` re-impulsa SAGAs `FAILED` y `COMPENSATING` atascadas. `FAILED` solo por `TICKET_ALREADY_USED`.
  Débito tardío tras terminar → `refund-credits` defensivo. Respuestas fuera de paso / `ALREADY_VOIDED` se ignoran. Inbox `processed_messages` en la misma TX.
- El comando `issue-ticket` incluye `organizerId` (del Event), `staffUserIds` (`[]`: el Event aún no tiene staff) y `eventEndsAt`, copiados al `SagaContext` (JSONB, sin migración; SAGAs previas sin snapshot omiten `organizerId`/`eventEndsAt`). Con ello ticketing restringe la validación al organizador del evento.
- El contrato no trae `endsAt`: `endsAt = startsAt + EVENT_DEFAULT_DURATION` (2 h). Se valida el `coverMediaId` (propio, `APPROVED`) en `createEvent` con `COVER_CHECK=on`; `coverUrl` vía `getMediaUrls` (degrada a null).
- Códigos del contrato: `INVALID_REGISTRATION_STATUS`, `CANCELLATION_WINDOW_CLOSED`, `MEDIA_NOT_APPROVED`, `INVALID_EVENT_STATUS`.
- Evento cancelado por el organizador/ADMIN: una SAGA `CANCELLATION` por inscripción `CONFIRMED` (lotes de 50); inscripciones en vuelo se cancelan al confirmarse.
- Los chaos flags (`CHAOS_TICKETING_FAIL`, `CHAOS_WALLET_DELAY_MS`) viven en ticketing/wallet; aquí solo existe el timeout. En las pruebas, los participantes simulados implementan esos comportamientos.
- Retry de entrega: colas `events-service.saga-replies.retry.5s|30s|5m` (de la infra) y DLQ; si faltan, se reencola.

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
