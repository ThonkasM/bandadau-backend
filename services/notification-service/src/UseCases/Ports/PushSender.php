<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Ports;

use Bandada\Notification\Entities\DeviceToken;

interface PushSender
{
    /**
     * @param  list<DeviceToken>  $devices
     * @param  array<string, string>  $data
     */
    public function send(array $devices, RenderedMessage $message, array $data): PushResult;
}
