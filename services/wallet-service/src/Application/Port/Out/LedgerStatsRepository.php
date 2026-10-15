<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\Out;

use Bandada\Wallet\Domain\Model\StatsGroupBy;
use DateTimeImmutable;

interface LedgerStatsRepository
{
    /**
     * Aggregates (zero-amount tombstones excluded) per bucket start (UTC date) and entry type.
     *
     * @return list<array{bucket:string,type:string,count:int,credits:int}>
     */
    public function aggregate(DateTimeImmutable $fromInclusive, DateTimeImmutable $toExclusive, StatsGroupBy $groupBy): array;

    /** Sum of all wallet balances implied by the ledger strictly before `$before`. */
    public function circulatingBefore(DateTimeImmutable $before): int;
}
