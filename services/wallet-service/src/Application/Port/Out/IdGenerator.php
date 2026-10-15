<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\Out;

interface IdGenerator
{
    /** UUIDv7. */
    public function next(): string;
}
