<?php

declare(strict_types=1);

namespace Bandada\Notification\Entities;

/** Browser PushSubscription (RFC 8030 / 8291): endpoint of the push service plus the client's public key and auth secret. */
final readonly class WebPushSubscription
{
    public function __construct(public string $endpoint, public string $p256dh, public string $auth) {}
}
