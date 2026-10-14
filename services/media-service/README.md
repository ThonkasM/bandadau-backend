# media-service

Multimedia y ML/DL: subidas a S3 con URL prefirmada, moderación NSFW/violencia, auto-etiquetado CLIP, OCR y procesamiento de video con ffmpeg.

| | |
|---|---|
| Stack | TypeScript + NestJS 11 · MongoDB (`media`) + S3 · onnxruntime-node · Clean Architecture |
| Puerto dev | 7003 |
| Rutas / dominio | `/api/v1/media` |
| Casos de uso | UC-05, UC-18 |

```bash
pnpm --filter media-service dev     # desarrollo (requiere `make infra-up` en `bandadau-infra`)
pnpm --filter media-service test    # pruebas
```

Configuración: copia `.env.example` a `.env`. Reglas, arquitectura, contratos, colas y gotchas:
**[`AGENTS.md`](AGENTS.md)** (lectura obligatoria para agentes de IA y personas).
Fuente de verdad del sistema: `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`.
