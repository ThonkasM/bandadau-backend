<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

use Bandada\Wallet\Domain\Model\StatsGroupBy;
use DateTimeImmutable;

final readonly class CreditStatsQuery
{
    /** @param DateTimeImmutable $from inclusive UTC day, $to inclusive UTC day */
    public function __construct(
        public DateTimeImmutable $from,
        public DateTimeImmutable $to,
        public StatsGroupBy $groupBy = StatsGroupBy::Day,
    ) {}
}
