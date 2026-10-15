<?php

declare(strict_types=1);

namespace Bandada\Notification\Entities;

enum Locale: string
{
    case Es = 'es';
    case En = 'en';

    public static function orDefault(?string $value): self
    {
        return self::tryFrom((string) $value) ?? self::Es;
    }
}
