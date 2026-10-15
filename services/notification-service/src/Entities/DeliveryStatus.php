<?php

declare(strict_types=1);

namespace Bandada\Notification\Entities;

enum DeliveryStatus: string
{
    /** Channel not requested for this notification. */
    case None = 'NONE';
    case Pending = 'PENDING';
    case Sent = 'SENT';
    case Failed = 'FAILED';
    /** Requested but not deliverable (push disabled, no devices, no email address). */
    case Skipped = 'SKIPPED';
}
