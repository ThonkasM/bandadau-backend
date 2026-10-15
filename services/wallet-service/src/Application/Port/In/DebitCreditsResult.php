<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

final readonly class DebitCreditsResult
{
    public const string DEBITED = 'DEBITED';

    public const string REPLAYED = 'REPLAYED';

    public const string FAILED = 'FAILED';

    public const string DUPLICATE_MESSAGE = 'DUPLICATE_MESSAGE';

    private function __construct(public string $outcome, public ?string $reason = null) {}

    public static function debited(): self
    {
        return new self(self::DEBITED);
    }

    public static function replayed(): self
    {
        return new self(self::REPLAYED);
    }

    public static function failed(string $reason): self
    {
        return new self(self::FAILED, $reason);
    }

    public static function duplicateMessage(): self
    {
        return new self(self::DUPLICATE_MESSAGE);
    }
}
