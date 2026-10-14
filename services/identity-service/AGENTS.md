# AGENTS.md — identity-service (S1)

Lee primero el `AGENTS.md` del workspace (`../../../AGENTS.md`), el del repo (`../../AGENTS.md`), `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md` y
`bandadau-docs/docs/04-patrones-y-reglas/arquitectura-hexagonal.md`.

## Identidad

Proveedor de identidad **único** de Bandada U (app, panel y MCP): registro con correo
institucional, verificación, login, refresh con rotación, handoff SSO app ↔ panel
(T13), tokens de servicio, universidades, roles, preferencias (`locale`, `theme`) y JWKS.
Es **upstream** de todos los contextos (Published Language: claims del JWT y
`bandada.identity.user.*`).

## Stack

Java 25 · Spring Boot 4 (Web MVC, Security, Data JPA, Actuator, Validation) · Gradle
Kotlin DSL · PostgreSQL 18 (`identity_db`) · Flyway · RabbitMQ (outbox) · OpenTelemetry ·
JUnit 5 + Testcontainers + ArchUnit. Verificar versiones exactas y APIs de Spring Boot 4
(Spring Framework 7, Jakarta EE 11) al implementar.

## Arquitectura: Hexagonal

Paquete `com.bandadau.identity`. Árbol completo en `arquitectura-hexagonal.md` §3:

```
src/main/java/com/bandadau/identity/
├── domain/{model,service,event,exception}
├── application/{port/in,port/out,service}
├── adapter/in/{web,messaging}  adapter/out/{persistence,messaging,external}
└── config/
src/main/resources/{application.yml, db/migration, messages_es.properties, messages_en.properties}
```

## Comandos (propuestos)

```bash
./gradlew bootRun                 # dev en :7001 (requiere make infra-up)
./gradlew test                    # unit + integración (Testcontainers) + ArchUnit
./gradlew spotlessApply spotlessCheck checkstyleMain
./gradlew build                   # jar + pruebas
./gradlew flywayInfo              # estado de migraciones
docker build -t bandada/identity-service .
```

## Variables de entorno (`.env.example`)

```
PORT=7001
DATABASE_URL=jdbc:postgresql://localhost:5432/identity_db
DATABASE_USER=identity
DATABASE_PASSWORD=change-me
RABBITMQ_URL=amqp://bandada:bandada@localhost:5672
JWT_ISSUER=http://api.bandada.localhost
JWT_PRIVATE_KEY_PATH=./secrets/jwt-private.pem      # RS256; nunca en git
JWT_KEY_ID=dev-2026-10
ACCESS_TOKEN_TTL=PT15M
REFRESH_TOKEN_TTL=P30D
HANDOFF_CODE_TTL=PT60S
APP_BASE_URL=http://app.bandada.localhost
ADMIN_BASE_URL=http://admin.bandada.localhost
SMTP_HOST=localhost
SMTP_PORT=1025
MAIL_FROM=no-reply@bandadau.com
SERVICE_CLIENTS=admin-gateway:secret,insights-service:secret   # client credentials (dev)
IDEMPOTENCY_TABLE=bandada-idempotency
DYNAMODB_ENDPOINT=http://localhost:8000
AWS_REGION=us-east-1
DEFAULT_LOCALE=es
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=identity-service
```

## Puertos y rutas

Dev **7001**. Público (Traefik): `/api/v1/auth/**`, `/api/v1/users/**`,
`/api/v1/universities`, `/.well-known/jwks.json`. Interno: `/internal/v1/users`,
`/internal/v1/universities`. Health: `/health/live`, `/health/ready` (Actuator mapeado).

## Contratos

- Implementa `bandadau-docs/contracts/openapi/identity-service.yaml`: `registerUser`, `verifyEmail`,
  `resendVerificationCode`, `login`, `refreshToken`, `logout`, `createHandoffCode`,
  `exchangeHandoffCode`, `issueServiceToken`, `getMe`, `updateMyPreferences`,
  `listUniversities`, `getJwks`, internos `searchUsers`, `updateUserRoles`,
  `updateUserStatus`, `createUniversity`, `updateUniversity`.
- No consume APIs de otros servicios.

## Mensajería

- **Publica** (outbox → `bandada.events`): `bandada.identity.user.registered.v1`,
  `…user.role-changed.v1`, `…user.suspended.v1`, `…user.preferences-changed.v1`.
- **Consume**: nada.

## Datos (`identity_db`)

`universities`, `users`, `user_roles`, `credentials`, `email_verifications`,
`refresh_tokens` (con `family_id`), `handoff_codes` (hash, `target_app`, `code_challenge`,
`expires_at`, `used_at`), `outbox`, `processed_messages`.

## Reglas específicas y gotchas

- El correo debe pertenecer a `University.allowedDomains` → si no, `422 EMAIL_DOMAIN_NOT_ALLOWED`.
- Contraseñas con Argon2id o BCrypt (puerto `PasswordHasherPort`); nunca loguear contraseñas, códigos ni tokens.
- Refresh token **rotativo**: reutilizar uno revocado revoca toda la familia (`REFRESH_TOKEN_REUSED`).
- Handoff code: 32 bytes aleatorios, guardado **hasheado**, 60 s, un solo uso, ligado a `userId` + `targetApp`,
  verificación PKCE (`codeChallenge` S256). `ADMIN` solo si el usuario tiene `MODERATOR` o `ADMIN`.
- JWT RS256 con `kid`; claims `sub`, `roles[]`, `universityId`, `locale`, `typ` (`user|service`).
  JWKS con `Cache-Control` para que los demás servicios lo cacheen.
- Problem Details localizados por `Accept-Language` (`es` por defecto, `en`) con `MessageSource`;
  `code` estable. El correo de verificación usa el `locale` del usuario.
- Rate-limit en `login`, `resend-code`, `register` (además del de Traefik).
- Seguridad: Spring Security solo como adaptador (`adapter/in/web` + `config`); el dominio no lo conoce.

## Casos de uso

UC-01 (registrarse), UC-02 (iniciar sesión), UC-03 (acceso único al panel), UC-21
(gestionar usuarios vía admin-gateway); soporte transversal a todos los UC con JWT.

## Definición de hecho

`bandadau-docs/docs/04-patrones-y-reglas/definition-of-done.md` (§0, §2, §3) + ArchUnit en verde +
pruebas de rotación de refresh y de handoff (expirado, reusado, `targetApp` incorrecto, PKCE inválido).
