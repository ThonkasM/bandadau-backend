<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Ports;

final readonly class PushResult
{
    /** @param list<string> $invalidTokens tokens Expo reported as DeviceNotRegistered */
    public function __construct(public bool $delivered, public array $invalidTokens = []) {}
}
