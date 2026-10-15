<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Gateways\System;

use Bandada\Notification\UseCases\Ports\Clock;
use DateTimeImmutable;
use DateTimeZone;

final readonly class SystemClock implements Clock
{
    public function now(): DateTimeImmutable
    {
        return new DateTimeImmutable('now', new DateTimeZone('UTC'));
    }
}
