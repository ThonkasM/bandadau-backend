# insights-service

Servidor MCP, agentes de monitoreo y de reportes, reportes generativos (texto, gráfico y audio TTS) y detección de anomalías.

| | |
|---|---|
| Stack | TypeScript + NestJS 11 · DynamoDB (`bandada-insights`) + S3 · MCP SDK · Clean Architecture |
| Puerto dev | 7008 |
| Rutas / dominio | `/api/v1/insights`, `/mcp` |
| Casos de uso | UC-19, UC-20, UC-22, UC-23 |

```bash
pnpm --filter insights-service dev     # desarrollo (requiere `make infra-up` en `bandadau-infra`)
pnpm --filter insights-service test    # pruebas
```

Configuración: copia `.env.example` a `.env`. Reglas, arquitectura, contratos, colas y gotchas:
**[`AGENTS.md`](AGENTS.md)** (lectura obligatoria para agentes de IA y personas).
Fuente de verdad del sistema: `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`.
