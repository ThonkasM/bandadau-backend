<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

use DateTimeImmutable;

final readonly class TopSpendersQuery
{
    /** @param DateTimeImmutable $from inclusive UTC day, $to inclusive UTC day */
    public function __construct(
        public DateTimeImmutable $from,
        public DateTimeImmutable $to,
        public int $limit = 10,
    ) {}
}
