<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Messaging;

use Bandada\Wallet\Adapter\Shared\Messaging\Exception\InvalidMessageException;

/** Typed access to a CloudEvent `data` object; any violation is a permanent (DLQ) error. */
final readonly class MessageData
{
    /** @param array<string, mixed> $data */
    public function __construct(private array $data) {}

    public function string(string $key): string
    {
        $value = $this->data[$key] ?? null;
        if (! is_string($value) || $value === '') {
            throw new InvalidMessageException("data.{$key} must be a non-empty string");
        }

        return $value;
    }

    public function optionalString(string $key): ?string
    {
        $value = $this->data[$key] ?? null;

        return is_string($value) && $value !== '' ? mb_substr($value, 0, 200) : null;
    }

    public function uuid(string $key): string
    {
        $value = strtolower($this->string($key));
        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $value) !== 1) {
            throw new InvalidMessageException("data.{$key} must be a UUID");
        }

        return $value;
    }

    public function positiveInt(string $key): int
    {
        $value = $this->nonNegativeInt($key);
        if ($value < 1) {
            throw new InvalidMessageException("data.{$key} must be >= 1");
        }

        return $value;
    }

    public function nonNegativeInt(string $key): int
    {
        $value = $this->data[$key] ?? null;
        if (! is_int($value) || $value < 0) {
            throw new InvalidMessageException("data.{$key} must be a non-negative integer");
        }

        return $value;
    }
}
