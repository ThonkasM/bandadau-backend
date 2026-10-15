<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Ports;

use DateTimeImmutable;

interface Clock
{
    public function now(): DateTimeImmutable;
}
