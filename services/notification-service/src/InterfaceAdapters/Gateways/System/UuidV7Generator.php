<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Gateways\System;

use Bandada\Notification\UseCases\Ports\IdGenerator;
use Ramsey\Uuid\Uuid;

final readonly class UuidV7Generator implements IdGenerator
{
    public function next(): string
    {
        return Uuid::uuid7()->toString();
    }
}
