<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Shared\Idempotency;

final readonly class IdempotencyOutcome
{
    public const string RESERVED = 'RESERVED';

    public const string REPLAY = 'REPLAY';

    public const string IN_PROGRESS = 'IN_PROGRESS';

    public const string KEY_REUSED = 'KEY_REUSED';

    /** @param array<string, string> $headers */
    private function __construct(
        public string $kind,
        public int $status = 0,
        public array $headers = [],
        public string $body = '',
    ) {}

    public static function reserved(): self
    {
        return new self(self::RESERVED);
    }

    /** @param array<string, string> $headers */
    public static function replay(int $status, array $headers, string $body): self
    {
        return new self(self::REPLAY, $status, $headers, $body);
    }

    public static function inProgress(): self
    {
        return new self(self::IN_PROGRESS);
    }

    public static function keyReused(): self
    {
        return new self(self::KEY_REUSED);
    }
}
