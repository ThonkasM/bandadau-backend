<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Devices;

use Bandada\Notification\UseCases\Ports\DeviceRepository;

final readonly class UnregisterDevice
{
    public function __construct(private DeviceRepository $devices) {}

    public function execute(string $userId, string $token): void
    {
        $this->devices->remove($userId, $token);
    }
}
