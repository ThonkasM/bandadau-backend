<?php

declare(strict_types=1);

namespace Bandada\Notification\Entities;

use DateTimeImmutable;

/** Per-user delivery preferences plus the local copy of locale/email used to render and address messages. */
final readonly class NotificationPreference
{
    /** @param list<NotificationType> $mutedTypes */
    public function __construct(
        public string $userId,
        public ChannelSet $channels,
        public array $mutedTypes,
        public Locale $locale,
        public ?string $email,
        public DateTimeImmutable $updatedAt,
        public ?DateTimeImmutable $localeUpdatedAt = null,
        public int $unreadCount = 0,
    ) {}

    public static function defaults(string $userId, DateTimeImmutable $now): self
    {
        return new self($userId, new ChannelSet, [], Locale::Es, null, $now);
    }

    /** @return list<Channel> channels to use for `$type`, honouring muted types and channel switches */
    public function channelsFor(NotificationType $type): array
    {
        $muted = $type->isMutable() && in_array($type, $this->mutedTypes, true);
        $result = [];
        foreach ($type->defaultChannels() as $channel) {
            $mandatory = $channel === Channel::InApp && ! $type->isMutable();
            if ($mandatory || (! $muted && $this->channels->allows($channel))) {
                $result[] = $channel;
            }
        }

        return $result;
    }
}
