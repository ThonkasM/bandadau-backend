# AGENTS.md — insights-service (S8)

Lee primero el `AGENTS.md` del workspace (`../../../AGENTS.md`), el del repo (`../../AGENTS.md`), `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`,
`bandadau-docs/docs/03-arquitectura/decisiones-clave.md` (D7, D8, D9), `bandadau-docs/docs/03-arquitectura/mcp.md`,
`bandadau-docs/docs/03-arquitectura/agentes-y-reportes-generativos.md` y `bandadau-docs/docs/04-patrones-y-reglas/clean-architecture.md`.

## Identidad

Inteligencia de la plataforma: **servidor MCP** (`/mcp`, T12), **agente de monitoreo**
(cron 5 min) y **agente de reportes** (bajo demanda) que son clientes MCP del propio servidor
(T5), **reportes generativos** texto + gráfico + **audio TTS** (T11), proyección de métricas desde
todos los eventos y **detección de anomalías** (Isolation Forest ONNX, T9).

## Stack

TypeScript · NestJS 11 · Node 24 · DynamoDB (`bandada-insights`) · S3/MinIO (audio) ·
`@modelcontextprotocol/sdk` (Streamable HTTP; verificar versión y API de transporte) ·
Claude API (`@anthropic-ai/sdk`, modelos `claude-sonnet-5-5` / `claude-haiku-5-5` según D8) u Ollama
en dev · Amazon Polly / Piper (TTS) · `onnxruntime-node` · RabbitMQ · Jest/Vitest · dependency-cruiser.

## Arquitectura: Clean Architecture

```
src/
├── entities/            generated-report, agent-run, alert, metric-point, alert-severity,
│                        policies/ (agent-guardrails: máx. 8 pasos, presupuesto de tokens), errors/
├── use-cases/
│   ├── ports/           llm.port.ts (LlmPort), tts.port.ts (TtsPort), mcp-client.port.ts,
│   │                    report.repository, agent-run.repository, alert.repository, metric.repository,
│   │                    audio-storage, anomaly-detector, platform-data (events/wallet/social/media internos),
│   │                    event-publisher, clock, id-generator
│   ├── reports/         request-report, generate-report (ReportAgent), get-report
│   ├── monitoring/      run-monitoring (MonitoringAgent), raise-alert, acknowledge-alert, list-alerts
│   ├── metrics/         project-domain-event (ACL → MetricPoint), get-platform-kpis, detect-anomalies
│   └── mcp-tools/       un caso de uso por herramienta de D9
├── interface-adapters/
│   ├── controllers/     http/ (reports, alerts, agent-runs), mcp/ (servidor MCP: registro de tools,
│   │                    resources `bandada://kpis/today`, `bandada://alerts/open`, prompts), messaging/
│   │                    (analytics.consumer), schedulers/ (monitoring.scheduler)
│   ├── presenters/      report.presenter (markdown + Vega-Lite con colores de tokens), problem-details
│   └── gateways/        llm/{claude,ollama}, tts/{polly,piper}, mcp/ (cliente MCP), internal-api/ (REST
│                        /internal con timeout + breaker), dynamo/, s3/, onnx/
└── frameworks-drivers/  main.ts, modules/, config/, prompts/{es,en}/ (prompts de sistema), observability/
```

## Estado de implementación (fase 2)

Implementado y verificado: REST (público + `/internal/v1`), servidor MCP con las 12 herramientas, 2 recursos y 2 prompts,
ReportAgent, MonitoringAgent, proyección `insights-service.analytics`, outbox, Dockerfile, compose y smoke.

- Agentes = clientes MCP por **HTTP loopback** (`MCP_INTERNAL_URL`) con token de servicio.
- `LlmPort`: `stub` (por defecto, determinista), `claude`, `ollama`. `TtsPort`: `none` (por defecto), `piper`, `polly`.
- Estructura real: `src/{entities,use-cases,interface-adapters,frameworks-drivers}`; prompts en `frameworks-drivers/prompts/prompts.ts`.
- Datos: `REPORT#`, `AGENTRUN#` (+`STEP#`, TTL 30 d), `ALERT#`, `METRIC#<name>/<fecha>`, `LOCK#`, `OUTBOX#`; GSI1 (`REPORT`, `AGENTRUN`, `ALERT#<status>`).

### Divergencias de contrato (documentadas)
- `/mcp` acepta el JWT de usuario ADMIN (aud `bandada-admin`) además del token MCP (`aud=mcp` + `mcp:tools`): identity aún no emite tokens MCP. `typ=mcp` no lo soporta `@bandada/auth-ts`.
- Los tokens de servicio de identity traen `internal:*`, no `mcp:tools`: se autoriza por `MCP_SERVICE_CLIENTS` (`MCP_REQUIRE_SCOPE=true` lo exige).
- Capability `resources.subscribe=false` (modo sin estado). `GET`/`DELETE /mcp` responden 405.
- `get_content_stats.reactionsByType` va en 0: social no desglosa reacciones por tipo.
- `QUEUE_BACKLOG` se mapea a `DLQ_BACKLOG` (no existe en `AlertKind`). `AgentRunStep.index` no se limita a 8 (se guardan pasos LLM y de herramienta).
- El `generate_report` del agente se persiste con caso de uso interno (la herramienta MCP no recibe `reportId`); `MaxSteps=8` aplica al bucle de recolección.
- Audio Piper es WAV (`summary.<locale>.wav`); Polly MP3.
- Pendiente: presupuesto mensual LLM, modelo ONNX, OTel métricas, `query_metrics` requiere `PROMETHEUS_URL`.

## Comandos

```bash
corepack pnpm test | test:int | lint | typecheck | arch | build | mcp:sync
cd ../../../bandadau-infra && docker compose --profile infra --profile services up -d --build --no-deps insights-service
make smoke    # o node smoke/smoke.mjs --only=insights
```

Las pruebas de integración usan la infra viva con tablas/colas propias (prefijo `it…`) y nunca publican en `bandada.events`.

## Puertos y rutas

Dev **7008**. Público `/api/v1/insights/**` (`requestReport` ♻️ → 202, `getReport`, alertas, agent-runs)
y `/mcp` (Streamable HTTP, Bearer JWT `ADMIN` o token de servicio).

## Contratos

`bandadau-docs/contracts/openapi/insights-service.yaml` y `bandadau-docs/contracts/mcp/tools.md` (herramientas D9:
`get_platform_kpis`, `get_registration_stats`, `list_events`, `get_credit_stats`, `get_content_stats`,
`list_flagged_content`, `list_failed_sagas`, `get_service_health`, `detect_anomalies`,
`generate_report`, `raise_alert`). Consume `/internal/v1/**` de events, wallet, social y media.

## Mensajería

- **Consume** (`insights-service.analytics`, `bandada.#`): proyección a `METRIC#…` con ACL.
- **Publica**: `bandada.insights.alert.raised.v1`, `bandada.insights.report.ready.v1`.

## Datos (DynamoDB `bandada-insights`)

`REPORT#<id>`, `AGENTRUN#<id>` (TTL 30 días), `METRIC#<name>` / `sk = <yyyy-mm-dd>`, `ALERT#<id>`.
S3: `reports/<reportId>/summary.<locale>.mp3`.

## Reglas específicas y gotchas

- **Contenido por locale**: el reporte se genera en el `locale` del solicitante (parámetro `locale` de
  `requestReport` o el del usuario); prompts de sistema en `prompts/{es,en}`; voz TTS por idioma.
- Audio = resumen ≤ 90 s, no el reporte entero.
- Herramientas MCP de **solo lectura** por defecto; `raise_alert` solo para agentes internos (token de servicio).
  Datos personales siempre agregados.
- Guardarraíles en `entities/policies`: límite de pasos y tokens; todo queda en `AgentRun` (herramientas, tokens, estado).
- Los agentes **no** llaman a gateways internos directo: usan el cliente MCP (mismas herramientas que un externo).
- `LlmPort`/`TtsPort` son puertos; nunca importar `@anthropic-ai/sdk` fuera de `gateways/llm`.
- En CI el LLM es un doble con respuestas grabadas; nunca llamar a la API de pago en pruebas automáticas.
- Problem Details localizados, `code` estable (`REPORT_NOT_FOUND`, `LLM_UNAVAILABLE`, `AGENT_STEP_LIMIT`).
- Colores del gráfico Vega-Lite desde `@bandada/ui-tokens` (`tokens.ts`).

## Casos de uso

UC-19 (reporte generativo), UC-20 (monitorear plataforma), UC-22 (consulta MCP externa), UC-23
(resumen semanal vía n8n).

## Definición de hecho

`definition-of-done.md` §0, §2, §3, §6 (anomalías), §8 (herramientas MCP) + prueba de agente con LLM falso
(límite de pasos, `AgentRun` registrado) + reporte en `es` y `en`.
