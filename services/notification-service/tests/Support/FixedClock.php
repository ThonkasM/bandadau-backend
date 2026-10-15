<?php

declare(strict_types=1);

namespace Tests\Support;

use Bandada\Notification\UseCases\Ports\Clock;
use DateInterval;
use DateTimeImmutable;
use DateTimeZone;

final class FixedClock implements Clock
{
    public function __construct(private DateTimeImmutable $now = new DateTimeImmutable('2026-10-14T15:00:00Z', new DateTimeZone('UTC'))) {}

    public function now(): DateTimeImmutable
    {
        return $this->now;
    }

    public function advance(string $interval): void
    {
        $this->now = $this->now->add(new DateInterval($interval));
    }
}
