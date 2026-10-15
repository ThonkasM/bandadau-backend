<?php

$bool = static fn (string $key, bool $default): bool => filter_var(env($key, $default), FILTER_VALIDATE_BOOLEAN);

return [
    'service' => 'notification-service',
    'table' => (string) env('NOTIFICATIONS_TABLE', 'bandada-notifications'),
    'ttl_days' => (int) env('NOTIFICATION_TTL_DAYS', 90),
    'inbox_ttl_days' => 14,
    'dedupe_ttl_days' => 7,
    'reaction_group_minutes' => 30,
    'deep_link_base' => rtrim((string) env('APP_DEEP_LINK_BASE', 'http://app.bandada.localhost'), '/'),
    'display_timezone' => 'America/La_Paz',

    'push' => [
        'enabled' => $bool('PUSH_ENABLED', false),
        'url' => (string) env('EXPO_PUSH_URL', 'https://exp.host/--/api/v2/push/send'),
        'access_token' => (string) env('EXPO_ACCESS_TOKEN', ''),
        'chunk_size' => 100,
    ],

    'email' => [
        'enabled' => $bool('EMAIL_ENABLED', true),
        'attempts' => 3,
        'backoff_ms' => [200, 1000],
    ],

    'jwt' => [
        'jwks_url' => (string) env('JWKS_URL', ''),
        'issuer' => (string) env('JWT_ISSUER', ''),
        'user_audiences' => array_values(array_filter(array_map('trim', explode(',', (string) env('JWT_USER_AUDIENCES', 'bandada-app,bandada-admin'))))),
        'internal_audience' => (string) env('JWT_INTERNAL_AUDIENCE', 'bandada-internal'),
        'leeway_seconds' => 30,
        'jwks_ttl_seconds' => (int) env('JWKS_CACHE_TTL', 300),
        'jwks_refresh_min_interval' => 30,
    ],

    'rabbitmq' => [
        'url' => (string) env('RABBITMQ_URL', ''),
        'queue' => 'notification-service.events',
        'events_exchange' => 'bandada.events',
        'commands_exchange' => 'bandada.commands',
        'dlx' => 'bandada.dlx',
        'bindings' => [
            'bandada.events.registration.#',
            'bandada.events.event.cancelled.v1',
            'bandada.social.#',
            'bandada.wallet.topup.#',
            'bandada.insights.alert.#',
            'bandada.identity.user.registered.v1',
            'bandada.identity.user.preferences-changed.v1',
        ],
        'prefetch' => (int) env('RABBITMQ_PREFETCH', 10),
        'declare_topology' => $bool('RABBITMQ_DECLARE_TOPOLOGY', false),
        'max_retries' => 3,
    ],

    'idempotency' => [
        'table' => (string) env('IDEMPOTENCY_TABLE', 'bandada-idempotency'),
        'ttl_seconds' => 86400,
        'lock_seconds' => 30,
    ],

    'dynamodb' => [
        'endpoint' => env('DYNAMODB_ENDPOINT') ?: null,
        'region' => (string) env('AWS_DEFAULT_REGION', 'us-east-1'),
        'key' => (string) env('AWS_ACCESS_KEY_ID', ''),
        'secret' => (string) env('AWS_SECRET_ACCESS_KEY', ''),
        // Dev/test only: create the tables when missing (in Compose bandadau-infra creates them).
        'auto_create_tables' => $bool('DYNAMODB_AUTO_CREATE_TABLES', false),
    ],
];
