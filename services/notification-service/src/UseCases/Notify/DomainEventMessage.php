<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Notify;

final readonly class DomainEventMessage
{
    /** @param array<string, mixed> $data */
    public function __construct(
        public string $id,
        public string $type,
        public ?string $time,
        public array $data,
    ) {}
}
