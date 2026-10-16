<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\Out;

/** Read-only view over the current wallet balances (internal stats, no personal data). */
interface BalanceOverviewRepository
{
    /** @return array{creditsInCirculation:int,walletsWithBalance:int} Sum of all balances and number of wallets with balance > 0. */
    public function totals(): array;

    /**
     * Wallets with the highest balance (> 0), descending; ties by user id.
     *
     * @return list<array{userId:string,balanceCredits:int}>
     */
    public function topBalances(int $limit): array;
}
