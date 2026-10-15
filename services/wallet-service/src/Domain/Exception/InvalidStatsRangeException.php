<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Exception;

final class InvalidStatsRangeException extends DomainException
{
    public function errorCode(): string
    {
        return 'INVALID_RANGE';
    }
}
