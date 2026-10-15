<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Exception;

final class TopUpNotPendingException extends DomainException
{
    public function __construct(public readonly string $topUpId, public readonly string $status)
    {
        parent::__construct("Top-up {$topUpId} is {$status}, not PENDING");
    }

    public function errorCode(): string
    {
        return $this->status === 'EXPIRED' ? 'TOPUP_EXPIRED' : 'TOPUP_NOT_PENDING';
    }

    public function params(): array
    {
        return ['status' => $this->status];
    }
}
