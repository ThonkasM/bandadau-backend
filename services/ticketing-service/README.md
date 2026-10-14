# ticketing-service

Entradas con QR firmado: emisión y anulación como paso 3 de la SAGA y validación en la puerta.

| | |
|---|---|
| Stack | TypeScript + NestJS 11 · DynamoDB (`bandada-ticketing`) · Clean Architecture |
| Puerto dev | 7006 |
| Rutas / dominio | `/api/v1/tickets` |
| Casos de uso | UC-12, UC-13, UC-14 |

```bash
pnpm --filter ticketing-service dev     # desarrollo (requiere `make infra-up` en `bandadau-infra`)
pnpm --filter ticketing-service test    # pruebas
```

Configuración: copia `.env.example` a `.env`. Reglas, arquitectura, contratos, colas y gotchas:
**[`AGENTS.md`](AGENTS.md)** (lectura obligatoria para agentes de IA y personas).
Fuente de verdad del sistema: `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`.
