<?php

declare(strict_types=1);

namespace Bandada\Notification\Entities\Exception;

use RuntimeException;

abstract class DomainException extends RuntimeException
{
    /** Stable machine-readable code (UPPER_SNAKE_CASE); clients translate by it. */
    abstract public function errorCode(): string;

    /** @return array<string, scalar|null> */
    public function params(): array
    {
        return [];
    }
}
