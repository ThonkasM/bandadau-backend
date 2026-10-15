<?php

namespace App\Support;

use RuntimeException;

/** Fail fast at boot (12-factor): a misconfigured service must not start half-working. */
class EnvironmentValidator
{
    /** @return list<string> problems found */
    public static function problems(): array
    {
        $problems = [];
        $env = (string) config('app.env');
        $production = $env === 'production';

        foreach ([
            'database.connections.pgsql.host' => 'DB_HOST',
            'database.connections.pgsql.database' => 'DB_DATABASE',
            'database.connections.pgsql.username' => 'DB_USERNAME',
            'wallet.rabbitmq.url' => 'RABBITMQ_URL',
            'wallet.jwt.jwks_url' => 'JWKS_URL',
            'wallet.jwt.issuer' => 'JWT_ISSUER',
            'wallet.payment.webhook_secret' => 'PAYMENT_WEBHOOK_SECRET',
            'wallet.idempotency.table' => 'IDEMPOTENCY_TABLE',
        ] as $path => $variable) {
            if (trim((string) config($path)) === '') {
                $problems[] = "{$variable} is required";
            }
        }

        $url = (string) config('wallet.rabbitmq.url');
        if ($url !== '' && ! preg_match('#^amqps?://#', $url)) {
            $problems[] = 'RABBITMQ_URL must start with amqp:// or amqps://';
        }
        $jwks = (string) config('wallet.jwt.jwks_url');
        if ($jwks !== '' && filter_var($jwks, FILTER_VALIDATE_URL) === false) {
            $problems[] = 'JWKS_URL must be a valid URL';
        }
        if (strlen((string) config('wallet.payment.webhook_secret')) < 16) {
            $problems[] = 'PAYMENT_WEBHOOK_SECRET must have at least 16 characters';
        }
        $allowedPackages = ['CREDITS_20', 'CREDITS_50', 'CREDITS_100'];
        $packages = config('wallet.topup.packages');
        if (! is_array($packages) || $packages === [] || array_diff($packages, $allowedPackages) !== []) {
            $problems[] = 'TOPUP_PACKAGES must be a non-empty subset of '.implode(',', $allowedPackages);
        }
        if ((int) config('wallet.topup.ttl_minutes') < 1) {
            $problems[] = 'TOPUP_TTL_MINUTES must be >= 1';
        }

        if ($production) {
            if (in_array((string) config('wallet.payment.webhook_secret'), ['change-me', 'change-me-webhook-secret'], true)) {
                $problems[] = 'PAYMENT_WEBHOOK_SECRET must not keep the example value in production';
            }
            if ((bool) config('wallet.payment.simulator_enabled')) {
                $problems[] = 'PAYMENT_SIMULATOR_ENABLED must be false in production';
            }
            if ((int) config('wallet.chaos.wallet_delay_ms') > 0) {
                $problems[] = 'CHAOS_WALLET_DELAY_MS must be 0 in production';
            }
        }
        if ((int) config('wallet.chaos.wallet_delay_ms') < 0) {
            $problems[] = 'CHAOS_WALLET_DELAY_MS must be >= 0';
        }

        return $problems;
    }

    public static function assertValid(): void
    {
        $problems = self::problems();
        if ($problems !== []) {
            throw new RuntimeException("Invalid environment configuration:\n - ".implode("\n - ", $problems));
        }
    }
}
