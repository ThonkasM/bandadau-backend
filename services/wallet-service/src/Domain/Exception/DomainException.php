<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Exception;

use RuntimeException;

abstract class DomainException extends RuntimeException
{
    /**
     * Stable machine-readable code (UPPER_SNAKE_CASE); clients translate by it.
     */
    abstract public function errorCode(): string;

    /**
     * Values interpolated into the localized detail message.
     *
     * @return array<string, scalar|null>
     */
    public function params(): array
    {
        return [];
    }
}
