<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Out\Messaging;

use Bandada\Wallet\Adapter\Shared\Support\Timestamps;
use Bandada\Wallet\Application\Port\Out\Clock;
use Bandada\Wallet\Application\Port\Out\EventPublisher;
use Bandada\Wallet\Application\Port\Out\IdGenerator;
use Bandada\Wallet\Domain\Event\DomainEvent;
use Bandada\Wallet\Domain\Event\EventContext;
use Illuminate\Database\ConnectionInterface;

/** Writes the CloudEvent to the outbox inside the caller's transaction; OutboxRelay ships it. */
final readonly class OutboxEventPublisher implements EventPublisher
{
    public function __construct(
        private ConnectionInterface $db,
        private CloudEventFactory $factory,
        private IdGenerator $ids,
        private Clock $clock,
        private string $eventsExchange,
    ) {}

    public function publish(DomainEvent $event, EventContext $context): void
    {
        $id = $this->ids->next();
        $built = $this->factory->build($id, $event, $context);

        $this->db->table('outbox')->insert([
            'id' => $id,
            'exchange' => $this->eventsExchange,
            'routing_key' => $built['routingKey'],
            'payload' => json_encode($built['payload'], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'headers' => json_encode(['traceparent' => $built['traceparent']], JSON_THROW_ON_ERROR),
            'aggregate_id' => $event->aggregateId(),
            'created_at' => Timestamps::toDb($this->clock->now()),
        ]);
    }
}
