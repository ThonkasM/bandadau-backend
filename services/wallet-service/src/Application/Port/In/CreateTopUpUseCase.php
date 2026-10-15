<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

interface CreateTopUpUseCase
{
    public function handle(CreateTopUpCommand $command): TopUpView;
}
