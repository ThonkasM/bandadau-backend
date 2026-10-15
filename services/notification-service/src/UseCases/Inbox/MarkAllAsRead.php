<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Inbox;

use Bandada\Notification\UseCases\Ports\Clock;
use Bandada\Notification\UseCases\Ports\NotificationRepository;
use DateTimeImmutable;

final readonly class MarkAllAsRead
{
    public function __construct(private NotificationRepository $notifications, private Clock $clock) {}

    /** @return array{updatedCount: int, readAt: DateTimeImmutable} */
    public function execute(string $userId): array
    {
        $now = $this->clock->now();

        return ['updatedCount' => $this->notifications->markAllRead($userId, $now), 'readAt' => $now];
    }
}
