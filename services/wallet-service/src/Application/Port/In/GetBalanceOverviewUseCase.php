<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

interface GetBalanceOverviewUseCase
{
    /** @param int $limit number of top wallets to return; clamped to 1..20 */
    public function handle(int $limit = 5): BalanceOverview;
}
