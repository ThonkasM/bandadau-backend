<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Inbox;

use Bandada\Notification\Entities\Exception\NotificationNotFoundException;
use Bandada\Notification\UseCases\Ports\Clock;
use Bandada\Notification\UseCases\Ports\NotificationRepository;
use Bandada\Notification\UseCases\Ports\TemplateRenderer;

/** Keys always include the caller's user id, so another user's notification simply "does not exist" (404). */
final readonly class MarkAsRead
{
    public function __construct(private NotificationRepository $notifications, private TemplateRenderer $templates, private Clock $clock) {}

    public function execute(string $userId, string $notificationId): NotificationView
    {
        $n = $this->notifications->markRead($userId, $notificationId, $this->clock->now())
            ?? throw new NotificationNotFoundException("Notification {$notificationId} not found");
        $message = $this->templates->render($n->type, $n->params, $n->locale);

        return new NotificationView($n, $message->title, $message->body);
    }
}
