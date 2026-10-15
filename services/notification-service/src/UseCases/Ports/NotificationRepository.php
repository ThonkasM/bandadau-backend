<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Ports;

use Bandada\Notification\Entities\Notification;
use DateTimeImmutable;

interface NotificationRepository
{
    /** Inbox item + notifications + profile/unread counters in one transaction (RN-24.1). */
    public function commit(CommitRequest $request): CommitResult;

    /** @return list<Notification> notifications created by the message that owns `$inboxKey` */
    public function inboxNotifications(string $inboxKey): array;

    public function find(string $userId, string $id): ?Notification;

    /**
     * Newest first; returns up to `$limit` items after `$afterId` (exclusive).
     *
     * @return list<Notification>
     */
    public function page(string $userId, int $limit, ?string $afterId, bool $unreadOnly): array;

    /** Idempotent: keeps the first readAt. Null when the notification does not exist for the user. */
    public function markRead(string $userId, string $id, DateTimeImmutable $now): ?Notification;

    public function markAllRead(string $userId, DateTimeImmutable $now): int;

    public function updateDelivery(Notification $notification): void;

    public function unreadCount(string $userId): int;
}
