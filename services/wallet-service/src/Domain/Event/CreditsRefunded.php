<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Event;

use DateTimeImmutable;

final readonly class CreditsRefunded implements DomainEvent
{
    public function __construct(
        public string $sagaId,
        public string $registrationId,
        public string $idempotencyKey,
        public string $userId,
        public ?string $ledgerEntryId,
        public int $amountCredits,
        public int $balanceCredits,
        public DateTimeImmutable $occurredAt,
    ) {}

    public function occurredAt(): DateTimeImmutable
    {
        return $this->occurredAt;
    }

    public function aggregateId(): string
    {
        return $this->registrationId;
    }
}
