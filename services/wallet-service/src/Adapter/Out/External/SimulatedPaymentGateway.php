<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Out\External;

use Bandada\Wallet\Application\Port\Out\PaymentGateway;
use Bandada\Wallet\Domain\Exception\PaymentGatewayUnavailableException;
use Bandada\Wallet\Domain\Model\TopUp;

/** Local stand-in for a real payment provider; the checkout page lives in the app. */
final readonly class SimulatedPaymentGateway implements PaymentGateway
{
    public const string MODE_SIMULATE = 'simulate';

    public const string MODE_UNAVAILABLE = 'unavailable';

    /** @param string $mode `simulate` (answers) or `unavailable` (every session creation fails: demo of UC-15 5a) */
    public function __construct(private string $checkoutBaseUrl, private bool $simulatorEnabled, private string $mode = self::MODE_SIMULATE) {}

    public function assertAvailable(): void
    {
        if ($this->mode === self::MODE_UNAVAILABLE) {
            throw new PaymentGatewayUnavailableException;
        }
    }

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
