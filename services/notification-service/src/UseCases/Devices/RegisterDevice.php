<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Devices;

use Bandada\Notification\Entities\DevicePlatform;
use Bandada\Notification\Entities\DeviceToken;
use Bandada\Notification\Entities\Exception\InvalidDeviceTokenException;
use Bandada\Notification\UseCases\Ports\Clock;
use Bandada\Notification\UseCases\Ports\DeviceRepository;

final readonly class RegisterDevice
{
    public function __construct(private DeviceRepository $devices, private Clock $clock) {}

    public function execute(string $userId, string $token, DevicePlatform $platform, ?string $appVersion, ?string $deviceName): DeviceToken
    {
        $length = strlen($token);
        if ($length < 8 || $length > 512) {
            throw new InvalidDeviceTokenException('Device token must have between 8 and 512 characters');
        }
        $now = $this->clock->now();

        return $this->devices->register(new DeviceToken($token, $userId, $platform, $appVersion, $deviceName, $now, $now));
    }
}
