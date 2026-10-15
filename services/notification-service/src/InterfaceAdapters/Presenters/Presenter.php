<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Presenters;

use Bandada\Notification\Entities\DeviceToken;
use Bandada\Notification\Entities\NotificationPreference;
use Bandada\Notification\InterfaceAdapters\Shared\Support\Timestamps;
use Bandada\Notification\UseCases\Inbox\NotificationView;

/** Entities to the exact JSON shapes of notification-service.yaml. */
final class Presenter
{
    /** @return array<string, mixed> */
    public static function notification(NotificationView $view): array
    {
        $n = $view->notification;

        return [
            'id' => $n->id,
            'userId' => $n->userId,
            'type' => $n->type->value,
            'title' => $view->title,
            'body' => $view->body,
            'locale' => $n->locale->value,
            'data' => (object) $n->data,
            'readAt' => $n->readAt() === null ? null : Timestamps::toApi($n->readAt()),
            'createdAt' => Timestamps::toApi($n->createdAt),
        ];
    }

    /** @return array<string, mixed> */
    public static function preferences(NotificationPreference $p): array
    {
        return [
            'userId' => $p->userId,
            'channels' => ['push' => $p->channels->push, 'email' => $p->channels->email, 'inApp' => $p->channels->inApp],
            'mutedTypes' => array_map(static fn ($t): string => $t->value, $p->mutedTypes),
            'updatedAt' => Timestamps::toApi($p->updatedAt),
        ];
    }

    /** @return array<string, mixed> */
    public static function device(DeviceToken $d): array
    {
        return [
            'token' => $d->token,
            'userId' => $d->userId,
            'platform' => $d->platform->value,
            'appVersion' => $d->appVersion,
            'deviceName' => $d->deviceName,
            'registeredAt' => Timestamps::toApi($d->registeredAt),
            'lastSeenAt' => Timestamps::toApi($d->lastSeenAt),
        ];
    }
}
