<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Out\External;

use Bandada\Wallet\Application\Port\Out\IdGenerator;
use Ramsey\Uuid\Uuid;

final readonly class UuidV7Generator implements IdGenerator
{
    public function next(): string
    {
        return Uuid::uuid7()->toString();
    }
}
