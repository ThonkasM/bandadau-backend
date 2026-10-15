<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Shared\Idempotency;

/** HTTP Idempotency-Key store (D3 mechanism 1); backed by DynamoDB `bandada-idempotency`. */
interface IdempotencyStore
{
    public function reserve(string $key, string $requestHash, string $principal): IdempotencyOutcome;

    /** @param array<string, string> $headers */
    public function complete(string $key, int $status, array $headers, string $body): void;

    public function release(string $key): void;
}
