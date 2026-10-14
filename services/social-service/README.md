# social-service

Red social: perfiles, posts, comentarios, reacciones, seguimientos, grupos de estudio, denuncias, feed personalizado y sugerencias con ML.

| | |
|---|---|
| Stack | TypeScript + NestJS 11 · MongoDB (`social`) · Clean Architecture |
| Puerto dev | 7002 |
| Rutas / dominio | `/api/v1/profiles`, `/posts`, `/feed`, `/groups`, `/follows`, `/reports` |
| Casos de uso | UC-04 a UC-10 |

```bash
pnpm --filter social-service dev     # desarrollo (requiere `make infra-up` en `bandadau-infra`)
pnpm --filter social-service test    # pruebas
```

Configuración: copia `.env.example` a `.env`. Reglas, arquitectura, contratos, colas y gotchas:
**[`AGENTS.md`](AGENTS.md)** (lectura obligatoria para agentes de IA y personas).
Fuente de verdad del sistema: `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`.
