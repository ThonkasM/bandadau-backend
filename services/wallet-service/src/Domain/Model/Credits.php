<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Model;

use Bandada\Wallet\Domain\Exception\InvalidCreditsException;

/** Non-negative integer amount of credits. Never a float or decimal. */
final readonly class Credits
{
    private function __construct(public int $amount) {}

    public static function of(int $amount): self
    {
        if ($amount < 0) {
            throw new InvalidCreditsException("Credits cannot be negative: {$amount}");
        }

        return new self($amount);
    }

    public static function zero(): self
    {
        return new self(0);
    }

    public function plus(self $other): self
    {
        if ($this->amount > PHP_INT_MAX - $other->amount) {
            throw new InvalidCreditsException('Credits overflow');
        }

        return new self($this->amount + $other->amount);
    }

    public function minus(self $other): self
    {
        if ($other->amount > $this->amount) {
            throw new InvalidCreditsException('Credits cannot go below zero');
        }

        return new self($this->amount - $other->amount);
    }

    public function lessThan(self $other): bool
    {
        return $this->amount < $other->amount;
    }

    public function isPositive(): bool
    {
        return $this->amount > 0;
    }

    public function isZero(): bool
    {
        return $this->amount === 0;
    }

    public function equals(self $other): bool
    {
        return $this->amount === $other->amount;
    }
}
