<?php

declare(strict_types=1);

namespace Bandada\Notification\Entities\Exception;

final class NotificationNotFoundException extends DomainException
{
    public function errorCode(): string
    {
        return 'NOTIFICATION_NOT_FOUND';
    }
}
