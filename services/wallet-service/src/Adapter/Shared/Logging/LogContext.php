<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Shared\Logging;

/** Per-request / per-message context attached to every JSON log line. */
final class LogContext
{
    private static ?string $correlationId = null;

    private static ?string $traceId = null;

    private static ?string $userId = null;

    public static function set(?string $correlationId, ?string $traceId, ?string $userId = null): void
    {
        self::$correlationId = $correlationId;
        self::$traceId = $traceId;
        self::$userId = $userId;
    }

    public static function setUser(?string $userId): void
    {
        self::$userId = $userId;
    }

    public static function clear(): void
    {
        self::$correlationId = self::$traceId = self::$userId = null;
    }

    public static function correlationId(): ?string
    {
        return self::$correlationId;
    }

    public static function traceId(): ?string
    {
        return self::$traceId;
    }

    public static function userId(): ?string
    {
        return self::$userId;
    }
}
