<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Event;

use DateTimeImmutable;

interface DomainEvent
{
    public function occurredAt(): DateTimeImmutable;

    /** Identifier of the aggregate the event refers to (registration or top-up). */
    public function aggregateId(): string;
}
