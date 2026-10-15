<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

interface GetMyWalletUseCase
{
    public function handle(string $userId): WalletView;
}
