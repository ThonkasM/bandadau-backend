# admin-gateway

BFF GraphQL del panel de administración: agrega las APIs internas de los servicios y expone queries, mutations y subscriptions.

| | |
|---|---|
| Stack | TypeScript + NestJS 11 + Apollo Server · sin base de datos · capas resolvers → data sources |
| Puerto dev | 7010 |
| Rutas / dominio | `/graphql` (HTTP + WebSocket) |
| Casos de uso | UC-18, UC-19, UC-20, UC-21 |

```bash
pnpm --filter admin-gateway dev     # desarrollo (requiere `make infra-up` en `bandadau-infra`)
pnpm --filter admin-gateway test    # pruebas
```

Configuración: copia `.env.example` a `.env`. Reglas, arquitectura, contratos, colas y gotchas:
**[`AGENTS.md`](AGENTS.md)** (lectura obligatoria para agentes de IA y personas).
Fuente de verdad del sistema: `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`.
