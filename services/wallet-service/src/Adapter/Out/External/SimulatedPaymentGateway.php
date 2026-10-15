<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Out\External;

use Bandada\Wallet\Application\Port\Out\PaymentGateway;
use Bandada\Wallet\Domain\Model\TopUp;

/** Local stand-in for a real payment provider; the checkout page lives in the app. */
final readonly class SimulatedPaymentGateway implements PaymentGateway
{
    public function __construct(private string $checkoutBaseUrl, private bool $simulatorEnabled) {}

    public function checkoutUrl(TopUp $topUp): string
    {
        return $this->checkoutBaseUrl.'/'.$topUp->id;
    }

    public function simulatorEnabled(): bool
    {
        return $this->simulatorEnabled;
    }

    public function simulatedGatewayRef(TopUp $topUp): string
    {
        return 'SIM-PAY-'.substr(hash('sha1', $topUp->id), 0, 8);
    }
}
