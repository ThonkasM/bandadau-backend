# notification-service

Notificaciones push (Expo), email e in-app generadas a partir de eventos de dominio, en el idioma de cada destinatario.

| | |
|---|---|
| Stack | PHP 8.4 + Laravel 12 · DynamoDB (`bandada-notifications`) · Clean Architecture |
| Puerto dev | 7007 |
| Rutas / dominio | `/api/v1/notifications`, `/api/v1/devices` |
| Casos de uso | UC-24, UC-12, UC-23 |

```bash
php artisan serve --port=7007     # desarrollo (requiere `make infra-up` en `bandadau-infra`)
./vendor/bin/pest    # pruebas
```

Configuración: copia `.env.example` a `.env`. Reglas, arquitectura, contratos, colas y gotchas:
**[`AGENTS.md`](AGENTS.md)** (lectura obligatoria para agentes de IA y personas).
Fuente de verdad del sistema: `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`.
