<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Exception;

final class InvalidTopUpPackageException extends DomainException
{
    public function __construct(public readonly string $package)
    {
        parent::__construct("Unknown or disabled top-up package {$package}");
    }

    public function errorCode(): string
    {
        return 'INVALID_TOPUP_PACKAGE';
    }
}
