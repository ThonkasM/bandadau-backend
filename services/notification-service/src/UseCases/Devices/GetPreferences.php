<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Devices;

use Bandada\Notification\Entities\NotificationPreference;
use Bandada\Notification\UseCases\Ports\Clock;
use Bandada\Notification\UseCases\Ports\PreferenceRepository;

final readonly class GetPreferences
{
    public function __construct(private PreferenceRepository $preferences, private Clock $clock) {}

    public function execute(string $userId): NotificationPreference
    {
        return $this->preferences->get($userId, $this->clock->now());
    }
}
