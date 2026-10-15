<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Exception;

final class TopUpNotFoundException extends DomainException
{
    public function __construct(public readonly string $topUpId)
    {
        parent::__construct("Top-up {$topUpId} not found");
    }

    public function errorCode(): string
    {
        return 'TOPUP_NOT_FOUND';
    }
}
