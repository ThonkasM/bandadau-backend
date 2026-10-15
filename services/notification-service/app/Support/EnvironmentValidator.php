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
        foreach ([
            'notification.table' => 'NOTIFICATIONS_TABLE',
            'notification.rabbitmq.url' => 'RABBITMQ_URL',
            'notification.jwt.jwks_url' => 'JWKS_URL',
            'notification.jwt.issuer' => 'JWT_ISSUER',
            'notification.idempotency.table' => 'IDEMPOTENCY_TABLE',
            'notification.deep_link_base' => 'APP_DEEP_LINK_BASE',
        ] as $path => $variable) {
            if (trim((string) config($path)) === '') {
                $problems[] = "{$variable} is required";
            }
        }
        if (! preg_match('#^amqps?://#', (string) config('notification.rabbitmq.url'))) {
            $problems[] = 'RABBITMQ_URL must start with amqp:// or amqps://';
        }
        if (filter_var((string) config('notification.jwt.jwks_url'), FILTER_VALIDATE_URL) === false) {
            $problems[] = 'JWKS_URL must be a valid URL';
        }
        if ((int) config('notification.ttl_days') < 1) {
            $problems[] = 'NOTIFICATION_TTL_DAYS must be >= 1';
        }
        if ((bool) config('notification.push.enabled') && ! filter_var((string) config('notification.push.url'), FILTER_VALIDATE_URL)) {
            $problems[] = 'EXPO_PUSH_URL must be a valid URL when PUSH_ENABLED=true';
        }
        if (config('mail.default') === 'smtp' && (trim((string) config('mail.mailers.smtp.host')) === '' || (int) config('mail.mailers.smtp.port') < 1)) {
            $problems[] = 'MAIL_HOST and MAIL_PORT are required for the smtp mailer';
        }
        if (trim((string) config('mail.from.address')) === '') {
            $problems[] = 'MAIL_FROM_ADDRESS is required';
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
