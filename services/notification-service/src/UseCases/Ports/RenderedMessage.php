<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Ports;

final readonly class RenderedMessage
{
    public function __construct(public string $title, public string $body, public bool $usedFallback = false) {}
}
