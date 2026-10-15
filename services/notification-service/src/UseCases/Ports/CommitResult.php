<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Ports;

final readonly class CommitResult
{
    /** @param list<string> $suppressedGroups throttling keys that were already claimed (nothing was written) */
    public function __construct(public bool $duplicate, public array $suppressedGroups = []) {}
}
