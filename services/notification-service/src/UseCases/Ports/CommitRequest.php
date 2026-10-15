<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Ports;

use Bandada\Notification\Entities\Notification;
use Bandada\Notification\Entities\ProfileSync;
use DateTimeImmutable;

/** Everything that must become durable atomically (one DynamoDB TransactWriteItems). */
final readonly class CommitRequest
{
    /**
     * @param  list<Notification>  $notifications  only those with `stored = true` are written
     * @param  list<ProfileSync>  $profiles  locale/email copies to upsert
     * @param  array<string, int>  $groupClaims  throttling keys (e.g. reaction grouping) => window in seconds
     */
    public function __construct(
        public string $inboxKey,
        public int $inboxTtlSeconds,
        public bool $inboxExpires,
        public array $notifications,
        public array $profiles,
        public array $groupClaims,
        public DateTimeImmutable $now,
    ) {}
}
