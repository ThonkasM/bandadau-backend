<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\UseCase;

use Bandada\Wallet\Application\Port\In\BalanceOverview;
use Bandada\Wallet\Application\Port\In\GetBalanceOverviewUseCase;
use Bandada\Wallet\Application\Port\Out\BalanceOverviewRepository;

final readonly class GetBalanceOverviewService implements GetBalanceOverviewUseCase
{
    private const int MAX_LIMIT = 20;

    public function __construct(private BalanceOverviewRepository $balances) {}

    public function handle(int $limit = 5): BalanceOverview
    {
        $totals = $this->balances->totals();
        $wallets = $totals['walletsWithBalance'];
        $average = $wallets > 0 ? round($totals['creditsInCirculation'] / $wallets, 2) : 0.0;

        return new BalanceOverview(
            $totals['creditsInCirculation'],
            $wallets,
            $average,
            $this->balances->topBalances(max(1, min(self::MAX_LIMIT, $limit))),
        );
    }
}
