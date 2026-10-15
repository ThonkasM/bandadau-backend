<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Devices;

use Bandada\Notification\Entities\ChannelSet;
use Bandada\Notification\Entities\Exception\NotMutableTypeException;
use Bandada\Notification\Entities\NotificationPreference;
use Bandada\Notification\Entities\NotificationType;
use Bandada\Notification\UseCases\Ports\Clock;
use Bandada\Notification\UseCases\Ports\PreferenceRepository;

final readonly class UpdatePreferences
{
    public function __construct(private PreferenceRepository $preferences, private Clock $clock) {}

    /** @param list<NotificationType> $mutedTypes */
    public function execute(string $userId, ChannelSet $channels, array $mutedTypes): NotificationPreference
    {
        foreach ($mutedTypes as $type) {
            if (! $type->isMutable()) {
                throw new NotMutableTypeException($type->value);
            }
        }

        return $this->preferences->save($userId, $channels, array_values(array_unique($mutedTypes, SORT_REGULAR)), $this->clock->now());
    }
}
