<?php

declare(strict_types=1);

namespace Bandada\Notification\Entities;

use DateTimeImmutable;

final readonly class DeviceToken
{
    public function __construct(
        public string $token,
        public string $userId,
        public DevicePlatform $platform,
        public ?string $appVersion,
        public ?string $deviceName,
        public DateTimeImmutable $registeredAt,
        public DateTimeImmutable $lastSeenAt,
    ) {}
}
