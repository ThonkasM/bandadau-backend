<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

interface RefundCreditsUseCase
{
    public function handle(RefundCreditsCommand $command): RefundCreditsResult;
}
