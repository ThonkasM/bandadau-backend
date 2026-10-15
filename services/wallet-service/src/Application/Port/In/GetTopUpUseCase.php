<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

interface GetTopUpUseCase
{
    public function handle(string $userId, string $topUpId): TopUpView;
}
