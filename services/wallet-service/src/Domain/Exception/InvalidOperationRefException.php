<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Exception;

final class InvalidOperationRefException extends DomainException
{
    public function errorCode(): string
    {
        return 'INVALID_OPERATION_REF';
    }
}
