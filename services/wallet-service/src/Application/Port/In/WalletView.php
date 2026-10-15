<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

use DateTimeImmutable;

final readonly class WalletView
{
    public function __construct(
        public string $userId,
        public int $balanceCredits,
        public DateTimeImmutable $updatedAt,
    ) {}
}
