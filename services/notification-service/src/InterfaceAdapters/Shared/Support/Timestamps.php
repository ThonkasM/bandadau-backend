<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Shared\Support;

use DateTimeImmutable;
use DateTimeZone;

final class Timestamps
{
    /** Postgres-friendly timestamptz literal with microseconds, in UTC. */
    public static function toDb(DateTimeImmutable $at): string
    {
        return $at->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.u\Z');
    }

    public static function fromDb(string $value): DateTimeImmutable
    {
        return (new DateTimeImmutable($value))->setTimezone(new DateTimeZone('UTC'));
    }

    /** API / CloudEvents representation (RFC 3339, UTC, seconds). */
    public static function toApi(DateTimeImmutable $at): string
    {
        return $at->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
    }
}
