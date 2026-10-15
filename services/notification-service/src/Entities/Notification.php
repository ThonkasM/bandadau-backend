<?php

declare(strict_types=1);

namespace Bandada\Notification\Entities;

use DateTimeImmutable;

/** In-app notification. Stores `type` + `params` (not rendered text) so it can be re-rendered per language. */
final class Notification
{
    /**
     * @param  array<string, mixed>  $params
     * @param  array<string, string>  $data
     */
    public function __construct(
        public readonly string $id,
        public readonly string $userId,
        public readonly NotificationType $type,
        public readonly array $params,
        public readonly array $data,
        public readonly Locale $locale,
        public readonly DateTimeImmutable $createdAt,
        public readonly DateTimeImmutable $expiresAt,
        private ?DateTimeImmutable $readAt = null,
        private DeliveryStatus $pushStatus = DeliveryStatus::None,
        private DeliveryStatus $emailStatus = DeliveryStatus::None,
        /** False when the user disabled the in-app channel: delivered on other channels but not kept. */
        public readonly bool $stored = true,
    ) {}

    public function readAt(): ?DateTimeImmutable
    {
        return $this->readAt;
    }

    public function isRead(): bool
    {
        return $this->readAt !== null;
    }

    /** Idempotent: a second call keeps the first timestamp. */
    public function markRead(DateTimeImmutable $now): void
    {
        $this->readAt ??= $now;
    }

    public function pushStatus(): DeliveryStatus
    {
        return $this->pushStatus;
    }

    public function emailStatus(): DeliveryStatus
    {
        return $this->emailStatus;
    }

    public function withDelivery(DeliveryStatus $push, DeliveryStatus $email): void
    {
        $this->pushStatus = $push;
        $this->emailStatus = $email;
    }

    public function deepLink(): ?string
    {
        return $this->data['deepLink'] ?? null;
    }
}
