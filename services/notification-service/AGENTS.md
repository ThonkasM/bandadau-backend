# AGENTS.md — notification-service (S7)

Lee primero el `AGENTS.md` del workspace (`../../../AGENTS.md`), el del repo (`../../AGENTS.md`), `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`,
`bandadau-docs/docs/04-patrones-y-reglas/clean-architecture.md` (§3, variante Laravel) y
`bandadau-docs/docs/04-patrones-y-reglas/i18n.md` §6.

## Identidad

Notificaciones **push** (Expo Push → APNs/FCM), **email** (SES / Mailpit) e **in-app**.
Traduce eventos de dominio de otros contextos a notificaciones para personas, **en el idioma
del destinatario** (`es`/`en`), respetando sus preferencias.

## Stack

PHP 8.4 · Laravel 12 · DynamoDB (`bandada-notifications`) con AWS SDK PHP · RabbitMQ
(`php-amqplib`, verificar versión) · Blade/Markdown mail para plantillas · Pest · Larastan 8 · Pint · Deptrac.

## Arquitectura: Clean Architecture

```
src/  (Bandada\Notification\)
├── Entities/            Notification, NotificationType, DeviceToken, NotificationPreference, Channel, Locale
├── UseCases/
│   ├── Ports/           NotificationRepository, DeviceRepository, PreferenceRepository, PushSender,
│   │                    EmailSender, TemplateRenderer, UserDirectory (locale/email), Clock, IdGenerator
│   ├── Notify/          NotifyRegistrationConfirmed, NotifyRegistrationFailed, NotifyNewComment,
│   │                    NotifyNewReaction, NotifyNewFollower, NotifyGroupRequest, NotifyTopUpPaid,
│   │                    NotifyContentFlagged, NotifyAlert, SendWelcomeEmail, SendEventReminder
│   ├── Inbox/           ListNotifications, MarkAsRead, MarkAllAsRead
│   └── Devices/         RegisterDevice, UnregisterDevice, GetPreferences, UpdatePreferences
└── InterfaceAdapters/
    ├── Controllers/{Http,Messaging}   Presenters/   Gateways/{Dynamo,Expo,Smtp,Blade}
app/Providers/   app/Console/Commands/ConsumeNotificationEvents.php   routes/api.php
resources/templates/{es,en}/<NotificationType>.{push,mail}.blade.php   lang/{es,en}/
```

## Comandos (propuestos)

```bash
composer install
php artisan serve --port=7007
php artisan notifications:consume           # consumidor de notification-service.events
./vendor/bin/pest
./vendor/bin/pint --test && ./vendor/bin/phpstan analyse && ./vendor/bin/deptrac analyse
```

## Variables de entorno (`.env.example`)

```
APP_ENV=local
APP_KEY=
APP_PORT=7007
APP_LOCALE=es
APP_FALLBACK_LOCALE=es
DYNAMODB_ENDPOINT=http://localhost:8000
AWS_DEFAULT_REGION=us-east-1
NOTIFICATIONS_TABLE=bandada-notifications
IDEMPOTENCY_TABLE=bandada-idempotency
RABBITMQ_URL=amqp://bandada:bandada@localhost:5672
JWKS_URL=http://localhost:7001/.well-known/jwks.json
JWT_ISSUER=http://api.bandada.localhost
MAIL_MAILER=smtp
MAIL_HOST=localhost
MAIL_PORT=1025
MAIL_FROM_ADDRESS=no-reply@bandadau.com
EXPO_PUSH_URL=https://exp.host/--/api/v2/push/send
EXPO_ACCESS_TOKEN=
APP_DEEP_LINK_BASE=http://app.bandada.localhost
NOTIFICATION_TTL_DAYS=90
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=notification-service
```

## Puertos y rutas

Dev **7007**. Público `/api/v1/notifications/**`, `/api/v1/devices/**`. Interno (para n8n,
UC-23): `/internal/v1/notifications` (envío dirigido) — **agregar al contrato antes de implementar**.

## Contratos

`bandadau-docs/contracts/openapi/notification-service.yaml`: `listNotifications`, `markNotificationRead`,
`markAllNotificationsRead`, `registerDevice` (PUT), `unregisterDevice`, `getNotificationPreferences`,
`updateNotificationPreferences`.

## Mensajería

- **Consume** (`notification-service.events`): `bandada.events.registration.#`, `bandada.social.#`,
  `bandada.wallet.topup.#`, `bandada.insights.alert.#`, `bandada.identity.user.registered.v1` y
  `bandada.identity.user.preferences-changed.v1` (copia local de `locale`; **añadir binding al catálogo vía ADR**).
- **Publica**: nada (servicio terminal).

## Datos (DynamoDB `bandada-notifications`)

`pk = USER#<userId>` / `sk = NOTIF#<uuidv7>` (TTL 90 días), `sk = DEVICE#<token>`, `sk = PREF`
(canales + `locale`). Inbox: ítem `pk = INBOX#<messageId>` / `sk = META` condicional (TTL 14 días).

## Reglas específicas y gotchas

- **Contenido por locale**: plantillas `resources/templates/{es,en}/…`; se usa el `locale` del
  destinatario (copia local), nunca el del emisor. Fallback `es`.
- La notificación in-app guarda `type` + `params` (no solo texto) para re-renderizar si cambia el idioma;
  la API devuelve `title`/`body` renderizados según `Accept-Language`.
- Eventos de dominio no traen textos: el servicio compone el mensaje.
- Respetar preferencias por canal; tokens Expo inválidos (`DeviceNotRegistered`) se eliminan.
- Emails solo en tema claro (D13). Nunca incluir contenido completo de posts en el email.
- Problem Details localizados con `code` estable (`NOTIFICATION_NOT_FOUND`, `INVALID_DEVICE_TOKEN`).
- Push en lote (límite de mensajes por petición de Expo: verificar) con reintento y backoff.

## Casos de uso

UC-24 (recibir notificaciones), UC-12 (confirmación/fallo), UC-07, UC-08, UC-09, UC-15, UC-18, UC-20,
UC-23 (recordatorios), UC-01 (bienvenida, junto a n8n).

## Definición de hecho

`definition-of-done.md` §0, §2, §3 + Deptrac + prueba por `NotificationType` en `es` y `en` + evento duplicado.
