<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

interface GetCreditStatsUseCase
{
    public function handle(CreditStatsQuery $query): CreditStats;
}
