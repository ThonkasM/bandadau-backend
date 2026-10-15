<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Event;

use DateTimeImmutable;

final readonly class CreditsDebitFailed implements DomainEvent
{
    public const string INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS';

    public const string WALLET_NOT_FOUND = 'WALLET_NOT_FOUND';

    public const string SAGA_ABORTED = 'SAGA_ABORTED';

    public function __construct(
        public string $sagaId,
        public string $registrationId,
        public string $idempotencyKey,
        public string $userId,
        public string $reason,
        public int $requiredCredits,
        public ?int $balanceCredits,
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
