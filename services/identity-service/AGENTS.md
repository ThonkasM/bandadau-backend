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

Java 25 · Spring Boot 4.0.8 (Web MVC, Security + OAuth2 resource server, **Spring JDBC `JdbcClient`**, Actuator, Validation, AMQP, Mail) · Gradle
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

## Comandos (verificados, todo en Docker)

```bash
make test-unit      # unitarias + ArchUnit (gradle:9-jdk25)
make test-java      # + integración Testcontainers (monta /var/run/docker.sock, TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal)
make image          # docker build (multi-stage, usuario no root, HEALTHCHECK curl /health/ready, 60% RAM)
```

Variables: ver `.env.example` (validadas al arrancar por `config/StartupValidator`). Persistencia: JDBC explícito (SQL con `FOR UPDATE`,
`RETURNING`, índices parciales) en lugar de JPA; las idempotency keys HTTP viven en Postgres (`idempotency_keys`), no en DynamoDB.

## Puertos y rutas

Dev **7001**. Público (Traefik): `/api/v1/auth/**`, `/api/v1/users/**`,
`/api/v1/universities`, `/.well-known/jwks.json`. Interno: `/internal/v1/users`,
`/internal/v1/universities`. Health: `/health/live`, `/health/ready` (Actuator mapeado).

## Contratos

- Implementa `bandadau-docs/contracts/openapi/identity-service.yaml`: `registerUser`, `verifyEmail`,
  `resendVerificationCode`, `login`, `refreshToken`, `logout`, `createHandoffCode`,
  `exchangeHandoffCode`, `issueServiceToken`, `getMe`, `updateMyPreferences`,
  `listUniversities`, `getJwks`, internos `searchUsers`, `updateUserRoles`,
  `updateUserStatus`, `createUniversity`, `updateUniversity`, `getMcpTokenStatus`; `createMcpToken`, `revokeMcpToken` (UC-22).
- No consume APIs de otros servicios.

## Decisiones de la fase 1

- Claims del JWT (`seguridad-y-sso.md`): `iss`, `aud` (`bandada-app|bandada-admin|bandada-internal`), `sub`, `typ` (`user|service`), `roles`, `uni`, `locale`, `scope`, `jti`; header `kid`.
  Token de servicio: `sub` = clientId, `scope` = `internal:read internal:write` (o los pedidos, intersectados con los permitidos del cliente).
- `signing_keys`: clave RSA generada al primer arranque, cifrada con `JWT_KEK` (AES-GCM); si `JWT_PRIVATE_KEY_PATH` existe se importa, si no se exporta ahí el PEM generado.
  Ciclo PENDING→ACTIVE→RETIRING→RETIRED (job diario, 90 d / 24 h).
- Contrato manda sobre los UC: `registerUser` → 201, `INVALID_VERIFICATION_CODE` 422, `INVALID_REFRESH_TOKEN`, `HANDOFF_CODE_INVALID` 401; bloqueo de login → 429 `RATE_LIMITED` + `Retry-After`.
- Registro de un correo ya activo: por defecto `REGISTER_HIDE_EXISTING_ACCOUNTS=true` aplica la anti-enumeración del UC-01 (201 + aviso por correo); con `false` responde 409 `EMAIL_ALREADY_REGISTERED`.
- `displayName` (opcional, contrato 1.3.0) se guarda en `users.display_name` y viaja en `user.registered`; si falta se deriva del correo.
- Rate limit (puerto `RateLimitPort`) por IP en `/auth/*` y por correo/usuario en resend/handoff: `RATE_LIMIT_STORE=postgres` (defecto; ventana fija compartida, tabla `rate_limit_windows`, UPSERT atómico con reloj de la BD, purga cada 5 min, *fail-open* si la BD falla) o `memory` (por instancia; tests). Ver ADR-0019.
- `/internal/**` exige scope (D-7): GET/HEAD → `internal:read`, resto → `internal:write`. `SERVICE_CLIENTS=id:secret[:scope|scope]` (por defecto ambos).
- Token MCP (UC-22): `aud=mcp`, `typ=user`, `roles=[ADMIN]`, `scope=mcp:tools`, 8 h, `jti` en `mcp_tokens`; insights consulta `GET /internal/v1/mcp-tokens/{jti}` para respetar la revocación. Identity rechaza `aud=mcp` en sus rutas.

- `User.suspendedAt` / `suspensionReason` (contrato 1.4.0): columnas `users.suspended_at` (V3) y `suspended_reason`; se rellenan al suspender y se limpian al reactivar.
- Outbox: el relay corre cada `OUTBOX_POLL_INTERVAL` (500 ms; alias antiguo `OUTBOX_RELAY_INTERVAL`) y un job horario purga las filas publicadas con más de `OUTBOX_RETENTION` (7 días).

## Mensajería

- **Publica** (outbox → `bandada.events`): `bandada.identity.user.registered.v1`,
  `…user.role-changed.v1`, `…user.suspended.v1`, `…user.preferences-changed.v1`.
- **Consume**: nada.

## Datos (`identity_db`)

`universities`, `users`, `user_roles`, `credentials`, `email_verifications`,
`mcp_tokens`, `rate_limit_windows`, `refresh_tokens` (con `family_id`), `handoff_codes` (hash, `target_app`, `code_challenge`,
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
