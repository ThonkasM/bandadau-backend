<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

interface DebitCreditsUseCase
{
    public function handle(DebitCreditsCommand $command): DebitCreditsResult;
}
