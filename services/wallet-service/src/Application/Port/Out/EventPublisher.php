<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\Out;

use Bandada\Wallet\Domain\Event\DomainEvent;
use Bandada\Wallet\Domain\Event\EventContext;

interface EventPublisher
{
    /** Writes to the transactional outbox; a relay publishes to the broker later. */
    public function publish(DomainEvent $event, EventContext $context): void;
}
