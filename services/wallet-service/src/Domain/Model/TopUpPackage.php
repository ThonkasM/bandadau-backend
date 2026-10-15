<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Model;

enum TopUpPackage: string
{
    case Credits20 = 'CREDITS_20';
    case Credits50 = 'CREDITS_50';
    case Credits100 = 'CREDITS_100';

    public function credits(): int
    {
        return match ($this) {
            self::Credits20 => 20,
            self::Credits50 => 50,
            self::Credits100 => 100,
        };
    }

    /** Reference price in minor units (1 credit = 1 BOB = 100 centavos). */
    public function priceMinor(): int
    {
        return $this->credits() * 100;
    }
}
