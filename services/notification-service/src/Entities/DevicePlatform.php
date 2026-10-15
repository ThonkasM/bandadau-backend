<?php

declare(strict_types=1);

namespace Bandada\Notification\Entities;

enum DevicePlatform: string
{
    case Ios = 'IOS';
    case Android = 'ANDROID';
    case Web = 'WEB';
}
