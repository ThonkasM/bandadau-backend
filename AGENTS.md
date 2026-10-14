# AGENTS.md — bandadau-backend

Repositorio con los **9 microservicios** de Bandada U. Lee primero `../AGENTS.md` (workspace) y
`../bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`.

## Servicios

| Carpeta | Stack | Base de datos | Arquitectura | Puerto |
|---|---|---|---|---|
| `services/identity-service` | Java 25 + Spring Boot 4 (Gradle) | PostgreSQL `identity_db` | Hexagonal | 7001 |
| `services/social-service` | NestJS 11 | MongoDB `social` | Clean | 7002 |
| `services/media-service` | NestJS 11 + onnxruntime-node + ffmpeg | MongoDB `media` + S3 | Clean | 7003 |
| `services/events-service` | Java 25 + Spring Boot 4 (Gradle) | PostgreSQL `events_db` | DDD (orquestador SAGA) | 7004 |
| `services/wallet-service` | PHP 8.4 + Laravel 12 (Composer) | PostgreSQL `wallet_db` | Hexagonal | 7005 |
| `services/ticketing-service` | NestJS 11 | DynamoDB `bandada-ticketing` | Clean | 7006 |
| `services/notification-service` | PHP 8.4 + Laravel 12 (Composer) | DynamoDB `bandada-notifications` | Clean | 7007 |
| `services/insights-service` | NestJS 11 (agentes + servidor MCP) | DynamoDB `bandada-insights` + S3 | Clean | 7008 |
| `services/admin-gateway` | NestJS 11 + Apollo (GraphQL) | — | Capas | 7010 |

Cada servicio tiene su `AGENTS.md` con árbol de carpetas, comandos, variables, colas y casos de uso.

## Reglas del repo

- Cada servicio es **independiente**: su propio build, `Dockerfile`, `.env.example`, pruebas y versión.
  Nunca importar código de otro servicio; se integran por REST `/internal`, eventos o comandos.
- Los servicios NestJS forman un **pnpm workspace** en la raíz de este repo (`pnpm-workspace.yaml`
  con `services/{social,media,ticketing,insights}-service` y `services/admin-gateway`). Consumen
  `@bandada/*` como dependencia local hermana: `file:../../../bandadau-shared/packages/<pkg>`.
- Java usa Gradle por servicio; PHP usa Composer por servicio.
- Contratos: solo desde `../bandadau-docs/contracts/`. Contract-first (ver `../AGENTS.md`).
- Las imágenes Docker se construyen desde `../bandadau-infra` con build context en `services/<x>`.
- Commits con scope = servicio: `feat(wallet): …`. CI con *path filters* por servicio.

## Comandos

```bash
pnpm install                              # dependencias de los servicios NestJS
pnpm --filter social-service test         # pruebas de un servicio Nest
(cd services/identity-service && ./gradlew test)
(cd services/wallet-service && composer test)
```

Para levantar el sistema completo: `cd ../bandadau-infra && make up`.
