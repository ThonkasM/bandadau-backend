<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Exception;

final class InsufficientFundsException extends DomainException
{
    public function __construct(public readonly int $requiredCredits, public readonly int $balanceCredits)
    {
        parent::__construct("Insufficient funds: required {$requiredCredits}, balance {$balanceCredits}");
    }

    public function errorCode(): string
    {
        return 'INSUFFICIENT_FUNDS';
    }

    public function params(): array
    {
        return ['required' => $this->requiredCredits, 'balance' => $this->balanceCredits];
    }
}
