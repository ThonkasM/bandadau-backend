<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Exception;

/** Raised by persistence when a top-up with the same (user, idempotency key) already exists. */
final class DuplicateTopUpException extends DomainException
{
    public function errorCode(): string
    {
        return 'CONFLICT';
    }
}
