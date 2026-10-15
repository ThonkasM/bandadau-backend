<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Notify;

use Bandada\Notification\Entities\ProfileSync;

final readonly class MappedEvent
{
    /** @param list<Intent> $intents */
    public function __construct(public array $intents = [], public ?ProfileSync $profile = null) {}

    public static function nothing(): self
    {
        return new self;
    }
}
