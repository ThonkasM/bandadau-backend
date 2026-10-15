<?php

declare(strict_types=1);

namespace Bandada\Notification\Entities;

use DateTimeImmutable;

/** Local copy of the identity data needed here (locale, email), carried by identity events. */
final readonly class ProfileSync
{
    public function __construct(
        public string $userId,
        public Locale $locale,
        public ?string $email,
        public DateTimeImmutable $eventTime,
    ) {}
}
