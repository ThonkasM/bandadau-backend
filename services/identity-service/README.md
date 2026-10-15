# identity-service

Proveedor de identidad único de Bandada U: registro con correo institucional, login, refresh rotativo, handoff SSO app ↔ panel, tokens de servicio, universidades, roles, preferencias y JWKS.

| | |
|---|---|
| Stack | Java 25 + Spring Boot 4.0.8 · Gradle · PostgreSQL (`identity_db`, Flyway) · RabbitMQ (outbox) · Hexagonal |
| Puerto | 7001 |
| Casos de uso | UC-01, UC-02, UC-03, UC-04 (preferencias), UC-21 |

## Quick start (todo en Docker, sin JDK/Gradle local)

```bash
cp .env.example .env
make test-unit     # unitarias + ArchUnit, sin socket Docker
make test-java     # + integración con Testcontainers (Postgres 18 y RabbitMQ 4); monta /var/run/docker.sock
make image         # docker build -t bandada/identity-service .
docker run --rm -p 7001:7001 --env-file .env --network <red-con-postgres-rabbit-mailpit> bandada/identity-service
```

`make test-java` ejecuta el contenedor `gradle:9-jdk25` con `-v /var/run/docker.sock:/var/run/docker.sock` y
`TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal`. Gradle task `integrationTest` = pruebas con `@Tag("integration")`.

## Variables

Ver `.env.example` (completo y comentado). Se validan al arrancar (fallo con la lista de variables inválidas).
Claves: `DATABASE_URL/USER/PASSWORD`, `RABBITMQ_URL`, `JWT_ISSUER`, `JWT_KEK`, `JWT_PRIVATE_KEY_PATH`, `SERVICE_CLIENTS`
(`id:secret[:scope|scope],...`), `APP_BASE_URL`, `ADMIN_BASE_URL`, `SMTP_HOST/PORT`, `MAIL_LOG_CODE`, `COOKIE_SECURE`,
`CORS_ORIGINS`, `AUTH_RATE_LIMIT_PER_MINUTE`, `REGISTER_HIDE_EXISTING_ACCOUNTS`, `RABBIT_DECLARE_TOPOLOGY` (solo dev standalone).

## Endpoints (contrato `identity-service.yaml`)

Implementados: `registerUser`, `verifyEmail`, `resendVerificationCode`, `login`, `refreshToken`, `logout`, `createHandoffCode`,
`exchangeHandoffCode`, `issueServiceToken` (en `/api/v1/auth/service-token`), `getMe`, `updateMyPreferences`, `listUniversities`,
`getJwks`, internos `searchUsers` (+ filtro extra `ids`), `updateUserRoles`, `updateUserStatus`, `createUniversity`, `updateUniversity`.
Diferidos (fase 2): `createMcpToken`, `revokeMcpToken` → `501 FEATURE_DISABLED`.
Salud: `GET /health/live`, `GET /health/ready` (DB + RabbitMQ).

Extensión sobre el contrato (documentada en `seguridad-y-sso.md` §5): cabecera `X-Bandada-Client: native|web|admin`; en `web`/`admin`
el refresh viaja en cookie `HttpOnly; SameSite=Strict; Path=/api/v1/auth` (`bandada_rt` / `bandada_admin_rt`) y el cuerpo omite `refreshToken`.

Ver `AGENTS.md` para arquitectura, mensajería y gotchas.
