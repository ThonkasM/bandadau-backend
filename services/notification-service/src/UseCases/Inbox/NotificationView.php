<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Inbox;

use Bandada\Notification\Entities\Notification;

/** A notification with the title/body rendered in its recipient's locale. */
final readonly class NotificationView
{
    public function __construct(public Notification $notification, public string $title, public string $body) {}
}
