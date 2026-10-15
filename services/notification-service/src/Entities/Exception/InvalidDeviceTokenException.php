<?php

declare(strict_types=1);

namespace Bandada\Notification\Entities\Exception;

final class InvalidDeviceTokenException extends DomainException
{
    public function errorCode(): string
    {
        return 'INVALID_DEVICE_TOKEN';
    }
}
