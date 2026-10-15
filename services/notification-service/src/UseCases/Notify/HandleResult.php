<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Notify;

final readonly class HandleResult
{
    public function __construct(public bool $duplicate, public int $notified) {}
}
