<?php

declare(strict_types=1);

namespace Bandada\Notification\Entities;

enum NotificationType: string
{
    case RegistrationConfirmed = 'REGISTRATION_CONFIRMED';
    case RegistrationFailed = 'REGISTRATION_FAILED';
    case EventReminder = 'EVENT_REMINDER';
    case NewComment = 'NEW_COMMENT';
    case NewReaction = 'NEW_REACTION';
    case NewFollower = 'NEW_FOLLOWER';
    case GroupRequest = 'GROUP_REQUEST';
    case TopUpPaid = 'TOPUP_PAID';
    case ContentFlagged = 'CONTENT_FLAGGED';
    case Alert = 'ALERT';
    case Welcome = 'WELCOME';
    case RegistrationCancelled = 'REGISTRATION_CANCELLED';
    case EventCancelled = 'EVENT_CANCELLED';
    case NewEvent = 'NEW_EVENT';

    /**
     * Channels this type is delivered on before applying the user's preferences.
     *
     * @return list<Channel>
     */
    public function defaultChannels(): array
    {
        return match ($this) {
            self::RegistrationConfirmed, self::RegistrationFailed, self::RegistrationCancelled, self::EventCancelled,
            self::EventReminder, self::TopUpPaid, self::ContentFlagged, self::Alert => [Channel::InApp, Channel::Push, Channel::Email],
            self::Welcome => [Channel::InApp],
            self::NewComment, self::NewReaction, self::NewFollower, self::GroupRequest, self::NewEvent => [Channel::InApp, Channel::Push],
        };
    }

    /** ALERT and REGISTRATION_FAILED always reach the in-app inbox and cannot be muted (RN-24.3). */
    public function isMutable(): bool
    {
        return ! in_array($this, [self::Alert, self::RegistrationFailed], true);
    }
}
