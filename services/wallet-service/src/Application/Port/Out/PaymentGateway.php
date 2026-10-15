<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\Out;

use Bandada\Wallet\Domain\Model\TopUp;

interface PaymentGateway
{
    public function checkoutUrl(TopUp $topUp): string;

    public function simulatorEnabled(): bool;

    /** Deterministic reference so repeating a simulated payment is a duplicate, not a second payment. */
    public function simulatedGatewayRef(TopUp $topUp): string;
}
