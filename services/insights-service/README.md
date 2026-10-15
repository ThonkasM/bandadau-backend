# insights-service

Servidor MCP, agentes de monitoreo y de reportes, reportes generativos (texto, gráfico y audio TTS), proyección de métricas y detección de anomalías.

| | |
|---|---|
| Stack | TypeScript + NestJS 11 · DynamoDB (`bandada-insights`) + S3/MinIO (`bandada-reports`) · `@modelcontextprotocol/sdk` 1.32 · Clean Architecture |
| Puerto dev | 7008 |
| Rutas | `/api/v1/insights` (ADMIN), `/internal/v1` (token de servicio), `/mcp` (Streamable HTTP, sin estado) |
| Casos de uso | UC-19, UC-20, UC-22, UC-23 (vía `requestReportInternal`) |

## Quick start

```bash
cd ../../../bandadau-infra
docker compose --profile infra --profile services up -d --build --no-deps insights-service   # :7008, Traefik /mcp y /api/v1/insights
make smoke                                                                                    # o: node smoke/smoke.mjs --only=insights
```

Sin ninguna clave funciona: `LLM_PROVIDER=stub` (por defecto) redacta el reporte con plantillas a partir de los datos reales y
`TTS_PROVIDER=none` genera el reporte sin audio.

## Proveedores (puertos)

| Puerto | Adaptadores | Variables |
|---|---|---|
| `LlmPort` | `stub` (determinista, por defecto), `claude` (`@anthropic-ai/sdk`, `claude-sonnet-5-5` / `claude-haiku-5-5`), `ollama` | `LLM_PROVIDER`, `ANTHROPIC_API_KEY`, `LLM_MODEL`, `LLM_MODEL_CHEAP`, `OLLAMA_URL`, `OLLAMA_MODEL`. `claude` sin clave: se deshabilita y usa el stub (aviso en el log) |
| `TtsPort` | `none`, `piper` (WAV), `polly` (MP3 neural; deshabilitado con credenciales `local`) | `TTS_PROVIDER`, `PIPER_URL`, `TTS_VOICE_ES/EN`, `POLLY_VOICE_ES/EN` |
| `AnomalyDetector` | z-score robusto (mediana/MAD) + 3×IQR | — (el ONNX lo sustituirá) |

## Comandos

```bash
corepack pnpm test        # unitarias + contrato MCP (LLM, MCP y plataforma falsos)
corepack pnpm test:int    # DynamoDB Local, RabbitMQ y MinIO de la infra viva; tablas/colas propias (prefijo it…)
corepack pnpm lint && corepack pnpm typecheck && corepack pnpm arch && corepack pnpm build
corepack pnpm mcp:sync    # copia contracts/mcp/tools.schema.json desde bandadau-docs
```

## Usar el MCP con un cliente

```bash
TOKEN=$(curl -s -X POST localhost:7001/api/v1/auth/login -H 'content-type: application/json' -H 'X-Bandada-Client: admin' \
  -d '{"email":"admin@umsa.edu.bo","password":"Bandada#2026"}' | jq -r .accessToken)
claude mcp add --transport http bandada http://api.bandada.localhost/mcp --header "Authorization: Bearer $TOKEN"
npx @modelcontextprotocol/inspector      # Streamable HTTP, URL http://localhost:7008/mcp, cabecera Authorization
```

El token de usuario dura 15 min; el token MCP de 8 h lo emitirá identity cuando implemente `createMcpToken`.

Detalles, divergencias y gotchas: **[`AGENTS.md`](AGENTS.md)**.
