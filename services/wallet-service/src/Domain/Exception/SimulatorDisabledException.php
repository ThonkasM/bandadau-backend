<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Exception;

final class SimulatorDisabledException extends DomainException
{
    public function __construct()
    {
        parent::__construct('Payment simulator is disabled');
    }

    public function errorCode(): string
    {
        return 'NOT_FOUND';
    }
}
