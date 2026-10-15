<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Exception;

final class WalletNotFoundException extends DomainException
{
    public function __construct(public readonly string $userId)
    {
        parent::__construct("Wallet not found for user {$userId}");
    }

    public function errorCode(): string
    {
        return 'WALLET_NOT_FOUND';
    }
}
