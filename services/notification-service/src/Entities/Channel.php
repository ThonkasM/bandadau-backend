<?php

declare(strict_types=1);

namespace Bandada\Notification\Entities;

enum Channel: string
{
    case InApp = 'IN_APP';
    case Push = 'PUSH';
    case Email = 'EMAIL';
}
