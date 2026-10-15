<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Ports;

use Bandada\Notification\Entities\DeviceToken;

interface DeviceRepository
{
    /** Upsert; a token owned by another user is reassigned to this one. Keeps the original registeredAt. */
    public function register(DeviceToken $device): DeviceToken;

    /** Idempotent. */
    public function remove(string $userId, string $token): void;

    /** @return list<DeviceToken> */
    public function forUser(string $userId): array;
}
