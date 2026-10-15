<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Controllers\Messaging;

use Bandada\Notification\InterfaceAdapters\Shared\Messaging\CloudEvent;
use Bandada\Notification\InterfaceAdapters\Shared\Messaging\Exception\InvalidMessageException;
use Bandada\Notification\UseCases\Notify\DomainEventMessage;
use Bandada\Notification\UseCases\Notify\HandleDomainEvent;

/** Routes every message of `notification-service.events` to the single UC-24 use case. */
final readonly class DomainEventDispatcher implements MessageHandler
{
    public function __construct(private HandleDomainEvent $handle) {}

    public function handle(CloudEvent $event): void
    {
        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $event->id) !== 1) {
            throw new InvalidMessageException('CloudEvent id must be a UUID');
        }
        $this->handle->execute(new DomainEventMessage($event->id, $event->type, $event->time, $event->data));
    }
}
