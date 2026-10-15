<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Exception;

final class ForbiddenOperationException extends DomainException
{
    public function __construct(string $message = 'Operation not allowed for this user')
    {
        parent::__construct($message);
    }

    public function errorCode(): string
    {
        return 'FORBIDDEN';
    }
}
