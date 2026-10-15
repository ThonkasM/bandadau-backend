<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Notify;

final readonly class NotificationSettings
{
    /** @param list<int> $emailBackoffMs wait between email attempts (attempts = count + 1) */
    public function __construct(
        public bool $pushEnabled,
        public bool $emailEnabled,
        public int $ttlDays,
        public int $inboxTtlDays,
        public int $dedupeTtlDays,
        public int $reactionGroupSeconds,
        public string $deepLinkBase,
        public array $emailBackoffMs = [200, 1000],
    ) {}
}
