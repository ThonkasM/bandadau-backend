<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

final readonly class RefundCreditsResult
{
    public const string REFUNDED = 'REFUNDED';

    public const string TOMBSTONE = 'TOMBSTONE';

    public const string REPLAYED = 'REPLAYED';

    public const string DUPLICATE_MESSAGE = 'DUPLICATE_MESSAGE';

    private function __construct(public string $outcome, public int $refundedCredits = 0) {}

    public static function refunded(int $credits): self
    {
        return new self(self::REFUNDED, $credits);
    }

    public static function tombstone(): self
    {
        return new self(self::TOMBSTONE, 0);
    }

    public static function replayed(int $credits): self
    {
        return new self(self::REPLAYED, $credits);
    }

    public static function duplicateMessage(): self
    {
        return new self(self::DUPLICATE_MESSAGE, 0);
    }
}
