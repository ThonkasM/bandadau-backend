# AGENTS.md — notification-service (S7)

Lee primero `../../../AGENTS.md`, `../../AGENTS.md`, `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md`,
`bandadau-docs/docs/04-patrones-y-reglas/clean-architecture.md`, `i18n.md` §6 y UC-24
(`bandadau-docs/docs/02-iconix/03-casos-de-uso/UC-24-recibir-notificaciones.md`).

## Identidad

Convierte eventos de dominio en notificaciones **in-app + email (+ push detrás de `PUSH_ENABLED`)** en el idioma del
destinatario, respetando sus preferencias. Servicio terminal: no publica eventos.

## Stack

PHP 8.4 · Laravel 12.70 (composition root) · DynamoDB `bandada-notifications` (+ `bandada-idempotency`) · RabbitMQ (`php-amqplib`) ·
Laravel Mailer (SMTP → Mailpit) · ICU `MessageFormatter` (ext-intl) · Pest · Larastan nivel 8 · Deptrac · Pint.

## Arquitectura: Clean

```
src/ (Bandada\Notification\)
├── Entities/            Notification, NotificationType, Channel, ChannelSet, NotificationPreference, DeviceToken, ProfileSync, Locale
├── UseCases/{Ports,Notify,Inbox,Devices}   HandleDomainEvent, SendNotification, EventToNotificationMapper, NotificationDelivery,
│                                           ListNotifications, MarkAsRead, MarkAllAsRead, RegisterDevice, UnregisterDevice, Get/UpdatePreferences
└── InterfaceAdapters/{Controllers/{Http,Messaging},Presenters,Gateways/{Dynamo,Expo,Smtp,Templates,System},Shared}
app/{Providers/NotificationServiceProvider,Console/Commands,Logging,Support}  routes/api.php  lang/{es,en}  resources/views/mail
```

Deptrac: Entities → nada; UseCases → Entities+Ports; InterfaceAdapters → hacia adentro; falla el build si se viola.

## Comandos

```bash
docker compose -f docker-compose.test.yml up -d --wait mq dynamo mailpit   # RabbitMQ:15611 Dynamo:15711 Mailpit:15811/15812
docker compose -f docker-compose.test.yml run --rm tests vendor/bin/pest   # 57 pruebas (unitarias + integración real)
docker compose -f docker-compose.test.yml run --rm tests sh -c "vendor/bin/pint --test && vendor/bin/phpstan analyse --memory-limit=512M && vendor/bin/deptrac analyse --fail-on-uncovered"
docker compose -f docker-compose.test.yml down -v
docker build -t bandada/notification-service:local .
```

Web Push (D-15): `PUSH_ENABLED=true` + `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (generar con `php artisan bandada:vapid-keys`; sin secretos en git).
`PlatformRoutingPushSender` enruta IOS/ANDROID → `ExpoPushSender` y WEB → `WebPushSender` (`minishlink/web-push` v11, VAPID + aes128gcm); 404/410 del push service ⇒ la suscripción se elimina.
La suscripción (`webPushSubscription`) se guarda en el item DEVICE. La app web obtiene la clave pública VAPID por su configuración (`applicationServerKey`).

Roles de la imagen: `web` (por defecto, nginx+php-fpm :7007; espera las tablas Dynamo), `php artisan notifications:consume`
(alias `bandada:consume`), `php artisan notifications:relay-outbox` (alias `bandada:relay`; **inactivo**: el servicio no
publica eventos, existe solo para que el servicio Compose `notification-relay` sea sano; puede omitirse).
Otros: `bandada:check-env`, `bandada:wait-for-schema` (verifica tablas y GSI1; crea solo con `DYNAMODB_AUTO_CREATE_TABLES=true`),
`bandada:declare-topology` (solo dev/tests).

## Variables (ver `.env.example`)

`NOTIFICATIONS_TABLE`, `IDEMPOTENCY_TABLE`, `DYNAMODB_ENDPOINT`, `AWS_*`, `RABBITMQ_URL`, `RABBITMQ_DECLARE_TOPOLOGY`, `JWKS_URL`,
`JWT_ISSUER`, `NOTIFICATION_TTL_DAYS`, `APP_DEEP_LINK_BASE`, `EMAIL_ENABLED`, `PUSH_ENABLED`, `EXPO_PUSH_URL`, `EXPO_ACCESS_TOKEN`, `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `WEB_PUSH_TTL_SECONDS`,
`MAIL_*`, `CORS_ORIGINS`, `LOG_CHANNEL` (`stdout`|`stderr`).

## Endpoints

Implementados: `listNotifications` (cursor, `unreadOnly`, cabecera `X-Unread-Count`), `markNotificationRead`,
`markAllNotificationsRead`, `getNotificationPreferences`, `updateNotificationPreferences`, `registerDevice`,
`unregisterDevice`, `sendNotification` (`/internal/v1/notifications`, `internal:write`, Idempotency-Key + `dedupeKey` 7 días),
`/health/live`, `/health/ready`. Diferido: exportador OTLP (no hay SDK OpenTelemetry para PHP en las dependencias; solo se propaga `traceparent`; las variables `OTEL_*` existen pero no se usan).

## Mensajería

Consume `notification-service.events` (bindings del catálogo §5). Inbox `INBOX#<messageId>`/META (TTL 14 d) escrito con las
notificaciones y el contador de no leídas en un solo `TransactWriteItems`. Un duplicado no crea nada y solo reanuda entregas
`PENDING`. Agrupación de reacciones: 1 por post/30 min (`INBOX#group:...`). `user.registered` / `user.preferences-changed`
mantienen la copia local `locale`+`email` en `PREF` (solo si el evento es más nuevo). Tipos desconocidos: se registra el inbox y se ignora.

## Decisiones / divergencias

- Título/cuerpo se renderizan con el `locale` guardado de la notificación (OpenAPI), no con `Accept-Language`.
- Enlaces profundos usan `APP_DEEP_LINK_BASE` (https), no `bandada://`.
- `ALERT` notifica a `recipientUserIds` (opcional en el AsyncAPI 1.3.0; si falta no se genera nada); `WELCOME` es solo in-app (el email lo envía n8n).
- Textos de comentarios/reacciones/seguidores nombran al actor si el evento trae `actorDisplayName` (opcional, AsyncAPI 1.3.0; parámetros `actorName`+`hasActor`); si no, texto genérico («Alguien»). social-service aún debe publicarlo.
- Scopes (D-7): `sendNotification` exige `internal:write` (ya implementado).
- Preferencias: `ALERT` y `REGISTRATION_FAILED` no se pueden silenciar (422 `TYPE_NOT_MUTABLE`).
