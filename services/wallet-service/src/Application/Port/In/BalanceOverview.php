<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

final readonly class BalanceOverview
{
    /** @param list<array{userId:string,balanceCredits:int}> $items */
    public function __construct(
        public int $creditsInCirculation,
        public int $walletsWithBalance,
        public float $averageBalance,
        public array $items,
    ) {}
}
