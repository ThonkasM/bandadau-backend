<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Ports;

use Bandada\Notification\Entities\ChannelSet;
use Bandada\Notification\Entities\NotificationPreference;
use Bandada\Notification\Entities\NotificationType;
use DateTimeImmutable;

interface PreferenceRepository
{
    /** Defaults (all channels on, nothing muted, locale es) when the user has no item yet. */
    public function get(string $userId, DateTimeImmutable $now): NotificationPreference;

    /** @param list<NotificationType> $mutedTypes */
    public function save(string $userId, ChannelSet $channels, array $mutedTypes, DateTimeImmutable $now): NotificationPreference;
}
