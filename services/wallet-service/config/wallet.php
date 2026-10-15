<?php

$bool = static fn (string $key, bool $default): bool => filter_var(env($key, $default), FILTER_VALIDATE_BOOLEAN);
$list = static fn (string $key, string $default): array => array_values(array_filter(array_map('trim', explode(',', (string) env($key, $default)))));

return [
    'service' => 'wallet-service',

    'topup' => [
        'packages' => $list('TOPUP_PACKAGES', 'CREDITS_20,CREDITS_50,CREDITS_100'),
        'ttl_minutes' => (int) env('TOPUP_TTL_MINUTES', 30),
        'currency' => 'BOB',
    ],

    'payment' => [
        'simulator_enabled' => $bool('PAYMENT_SIMULATOR_ENABLED', false),
        'webhook_secret' => (string) env('PAYMENT_WEBHOOK_SECRET', ''),
        'webhook_tolerance_seconds' => (int) env('PAYMENT_WEBHOOK_TOLERANCE_SECONDS', 300),
        'checkout_base_url' => rtrim((string) env('PAYMENT_CHECKOUT_BASE_URL', 'http://app.bandada.localhost/wallet/checkout'), '/'),
    ],

    'jwt' => [
        'jwks_url' => (string) env('JWKS_URL', ''),
        'issuer' => (string) env('JWT_ISSUER', ''),
        'user_audiences' => $list('JWT_USER_AUDIENCES', 'bandada-app,bandada-admin'),
        'internal_audience' => (string) env('JWT_INTERNAL_AUDIENCE', 'bandada-internal'),
        'leeway_seconds' => 30,
        'jwks_ttl_seconds' => (int) env('JWKS_CACHE_TTL', 300),
        'jwks_refresh_min_interval' => 30,
    ],

    'rabbitmq' => [
        'url' => (string) env('RABBITMQ_URL', ''),
        'commands_queue' => 'wallet-service.commands',
        'events_exchange' => 'bandada.events',
        'commands_exchange' => 'bandada.commands',
        'dlx' => 'bandada.dlx',
        'prefetch' => (int) env('RABBITMQ_PREFETCH', 20),
        'declare_topology' => $bool('RABBITMQ_DECLARE_TOPOLOGY', false),
        'max_retries' => 3,
    ],

    'outbox' => [
        'poll_interval_ms' => (int) env('OUTBOX_POLL_INTERVAL_MS', 500),
        'batch_size' => 100,
        'retention_days' => 7,
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
    ],

    'chaos' => [
        'wallet_delay_ms' => (int) env('CHAOS_WALLET_DELAY_MS', 0),
    ],
];
