# events-service

Eventos, talleres e inscripciones con cupo y precio en créditos. Orquestador de la SAGA de inscripción (events → wallet → ticketing) con compensaciones.

| | |
|---|---|
| Stack | Java 25 + Spring Boot 4 · PostgreSQL (`events_db`) · DDD táctico |
| Puerto dev | 7004 |
| Rutas / dominio | `/api/v1/events`, `/api/v1/registrations` |
| Casos de uso | UC-11, UC-12, UC-13 |

```bash
./gradlew bootRun     # desarrollo (requiere `make infra-up` en `bandadau-infra`)
./gradlew test    # pruebas
```

Configuración: copia `.env.example` a `.env`. Reglas, arquitectura, contratos, colas y gotchas:
**[`AGENTS.md`](AGENTS.md)** (lectura obligatoria para agentes de IA y personas).
Fuente de verdad del sistema: `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`.
