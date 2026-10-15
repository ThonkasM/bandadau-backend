<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Shared\Messaging;

/** Minimal W3C Trace Context helpers (no exporter: only propagation). */
final class Traceparent
{
    private const string PATTERN = '/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/';

    public static function generate(): string
    {
        return '00-'.bin2hex(random_bytes(16)).'-'.bin2hex(random_bytes(8)).'-01';
    }

    public static function isValid(?string $value): bool
    {
        return $value !== null && preg_match(self::PATTERN, $value) === 1;
    }

    /** Same trace, new span id: used when a hop (relay, consumer) creates its own span. */
    public static function child(?string $parent): string
    {
        if ($parent === null || preg_match(self::PATTERN, $parent, $m) !== 1) {
            return self::generate();
        }

        return '00-'.$m[1].'-'.bin2hex(random_bytes(8)).'-'.$m[3];
    }

    public static function traceId(?string $value): ?string
    {
        if ($value === null || preg_match(self::PATTERN, $value, $m) !== 1) {
            return null;
        }

        return $m[1];
    }
}
