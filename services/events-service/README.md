# events-service

Eventos y talleres universitarios e inscripciones con cupo y precio en créditos. **Orquestador de la SAGA** de inscripción/cancelación
(events → wallet → ticketing) con outbox/inbox, timeouts y compensaciones.

| | |
|---|---|
| Stack | Java 25 + Spring Boot 4.0.8 · Gradle · PostgreSQL (`events_db`, Flyway) · RabbitMQ · DDD |
| Puerto | 7004 |
| Casos de uso | UC-11, UC-12, UC-13 |

## Quick start (todo en Docker)

```bash
cp .env.example .env
make test-unit     # dominio (tabla de transiciones de la SAGA), ArchUnit
make test-java     # + integración Testcontainers (Postgres 18 + RabbitMQ 4) con wallet/ticketing simulados: S1-S6, S9, S10, idempotencia, cover, internos
make image
```

Prueba manual contra la infra viva (identity, RabbitMQ, Mailpit arriba) mientras wallet/ticketing reales no existan:

```bash
python3 scripts/simulate-participants.py --mgmt http://localhost:15672          # añade --fail-ticketing para la compensación
python3 scripts/smoke-e2e.py --identity http://localhost:7001 --events http://localhost:7004 --mailpit http://localhost:8025 [--expect-failure]
```

## Variables

Ver `.env.example`. Principales: `DATABASE_URL/USER/PASSWORD`, `RABBITMQ_URL`, `JWKS_URL`, `JWT_ISSUER`, `IDENTITY_SERVICE_URL`,
`SERVICE_CLIENT_ID/SECRET`, `COVER_CHECK=on|off`, `MEDIA_SERVICE_URL`, `SAGA_STEP_TIMEOUT`, `SAGA_RESEND_OFFSETS`,
`SAGA_COMPENSATION_BACKOFF(_CAP)`, `SAGA_COMPENSATION_ALERT_AFTER`, `SAGA_SCHEDULER_INTERVAL`, `EVENT_DEFAULT_DURATION`.

## Endpoints (contrato `events-service.yaml`)

Implementados todos: `createEvent`, `listEvents`, `getEvent`, `publishEvent`, `cancelEvent`, `registerToEvent`, `listMyRegistrations`,
`getRegistration`, `cancelRegistration`, internos `listSagas`, `retrySaga`, `listEventsInternal`, `getRegistrationStats`, `listEventRegistrations`.
Salud: `/health/live`, `/health/ready`.

## Mensajería

Consume `events-service.saga-replies` (la crea/verifica la infra; el servicio no declara colas salvo `RABBIT_DECLARE_TOPOLOGY=true`).
Publica por outbox en `bandada.commands` (`bandada.wallet.cmd.debit-credits|refund-credits.v1`, `bandada.ticketing.cmd.issue-ticket|void-ticket.v1`) y
`bandada.events` (`event.published|cancelled`, `registration.confirmed|failed|cancelled`). Ver `AGENTS.md`.
