<?php

declare(strict_types=1);

namespace Bandada\Notification\Entities;

final readonly class ChannelSet
{
    public function __construct(public bool $push = true, public bool $email = true, public bool $inApp = true) {}

    public function allows(Channel $channel): bool
    {
        return match ($channel) {
            Channel::Push => $this->push,
            Channel::Email => $this->email,
            Channel::InApp => $this->inApp,
        };
    }
}
