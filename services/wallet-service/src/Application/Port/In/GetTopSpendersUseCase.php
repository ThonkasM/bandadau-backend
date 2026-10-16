<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

interface GetTopSpendersUseCase
{
    public function handle(TopSpendersQuery $query): TopSpenders;
}
