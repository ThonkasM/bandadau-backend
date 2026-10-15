<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Out\External;

use Bandada\Wallet\Application\Port\Out\Clock;
use DateTimeImmutable;
use DateTimeZone;

final readonly class SystemClock implements Clock
{
    public function now(): DateTimeImmutable
    {
        return new DateTimeImmutable('now', new DateTimeZone('UTC'));
    }
}
