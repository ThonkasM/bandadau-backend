# wallet-service

Billetera de créditos enteros: saldo, libro mayor, recargas con pasarela simulada y débito/reembolso como pasos de la SAGA.

| | |
|---|---|
| Stack | PHP 8.4 + Laravel 12 · PostgreSQL (`wallet_db`) · Hexagonal |
| Puerto dev | 7005 |
| Rutas / dominio | `/api/v1/wallet` |
| Casos de uso | UC-12, UC-13, UC-15, UC-16 |

```bash
php artisan serve --port=7005     # desarrollo (requiere `make infra-up` en `bandadau-infra`)
./vendor/bin/pest    # pruebas
```

Configuración: copia `.env.example` a `.env`. Reglas, arquitectura, contratos, colas y gotchas:
**[`AGENTS.md`](AGENTS.md)** (lectura obligatoria para agentes de IA y personas).
Fuente de verdad del sistema: `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`.
