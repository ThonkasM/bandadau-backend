<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

final readonly class CreateTopUpCommand
{
    public function __construct(
        public string $userId,
        public string $package,
        public string $idempotencyKey,
    ) {}
}
