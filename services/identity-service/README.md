# identity-service

Proveedor de identidad único de Bandada U: registro con correo institucional, login, refresh rotativo, handoff SSO app ↔ panel, tokens de servicio, universidades, roles, preferencias y JWKS.

| | |
|---|---|
| Stack | Java 25 + Spring Boot 4 · PostgreSQL (`identity_db`) · Hexagonal |
| Puerto dev | 7001 |
| Rutas / dominio | `/api/v1/auth`, `/api/v1/users`, `/api/v1/universities`, `/.well-known` |
| Casos de uso | UC-01, UC-02, UC-03, UC-21 |

```bash
./gradlew bootRun     # desarrollo (requiere `make infra-up` en `bandadau-infra`)
./gradlew test    # pruebas
```

Configuración: copia `.env.example` a `.env`. Reglas, arquitectura, contratos, colas y gotchas:
**[`AGENTS.md`](AGENTS.md)** (lectura obligatoria para agentes de IA y personas).
Fuente de verdad del sistema: `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`.
