<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Ports;

interface IdGenerator
{
    /** UUIDv7 (time-ordered: the notification sort key). */
    public function next(): string;
}
