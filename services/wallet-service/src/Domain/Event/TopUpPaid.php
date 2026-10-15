<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Event;

use DateTimeImmutable;

final readonly class TopUpPaid implements DomainEvent
{
    public function __construct(
        public string $topUpId,
        public string $userId,
        public string $package,
        public int $amountCredits,
        public string $gatewayRef,
        public string $ledgerEntryId,
        public int $balanceCredits,
        public DateTimeImmutable $occurredAt,
    ) {}

    public function occurredAt(): DateTimeImmutable
    {
        return $this->occurredAt;
    }

    public function aggregateId(): string
    {
        return $this->topUpId;
    }
}
