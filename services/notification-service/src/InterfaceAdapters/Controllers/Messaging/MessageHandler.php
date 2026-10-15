<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Controllers\Messaging;

use Bandada\Notification\InterfaceAdapters\Shared\Messaging\CloudEvent;
use Bandada\Notification\InterfaceAdapters\Shared\Messaging\Exception\InvalidMessageException;

interface MessageHandler
{
    /**
     * @throws InvalidMessageException permanent failure (DLQ)
     */
    public function handle(CloudEvent $event): void;
}
