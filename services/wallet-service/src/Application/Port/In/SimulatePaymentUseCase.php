<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

use Bandada\Wallet\Domain\Event\EventContext;

interface SimulatePaymentUseCase
{
    /** @param 'PAID'|'FAILED' $outcome */
    public function handle(string $userId, string $topUpId, string $outcome, EventContext $context): TopUpView;
}
