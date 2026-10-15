<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Exception;

final class AmountMismatchException extends DomainException
{
    public function __construct(public readonly int $expectedMinor, public readonly int $receivedMinor)
    {
        parent::__construct("Amount mismatch: expected {$expectedMinor}, received {$receivedMinor}");
    }

    public function errorCode(): string
    {
        return 'AMOUNT_MISMATCH';
    }

    public function params(): array
    {
        return ['expected' => $this->expectedMinor, 'received' => $this->receivedMinor];
    }
}
