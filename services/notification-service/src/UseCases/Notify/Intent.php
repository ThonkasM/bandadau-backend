<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Notify;

use Bandada\Notification\Entities\NotificationType;

/** "Tell this user about this" as decided from an event, before preferences are applied. */
final readonly class Intent
{
    /**
     * @param  array<string, mixed>  $params
     * @param  array<string, string>  $data
     */
    public function __construct(
        public string $userId,
        public NotificationType $type,
        public array $params = [],
        public array $data = [],
        public ?string $groupKey = null,
    ) {}
}
