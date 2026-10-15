<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Shared\Messaging;

use Bandada\Notification\InterfaceAdapters\Shared\Messaging\Exception\InvalidMessageException;
use JsonException;

final readonly class CloudEvent
{
    /** @param array<string, mixed> $data */
    public function __construct(
        public string $id,
        public string $type,
        public string $source,
        public ?string $time,
        public ?string $subject,
        public ?string $correlationId,
        public ?string $causationId,
        public ?string $sagaId,
        public ?string $traceparent,
        public array $data,
    ) {}

    /** @throws InvalidMessageException */
    public static function fromJson(string $json): self
    {
        try {
            $payload = json_decode($json, true, 32, JSON_THROW_ON_ERROR);
        } catch (JsonException $e) {
            throw new InvalidMessageException('Message body is not valid JSON', 0, $e);
        }
        if (! is_array($payload) || ($payload['specversion'] ?? null) !== '1.0') {
            throw new InvalidMessageException('Not a CloudEvents 1.0 envelope');
        }
        foreach (['id', 'type', 'source'] as $required) {
            if (! isset($payload[$required]) || ! is_string($payload[$required]) || $payload[$required] === '') {
                throw new InvalidMessageException("Missing CloudEvents attribute {$required}");
            }
        }
        if (! isset($payload['data']) || ! is_array($payload['data'])) {
            throw new InvalidMessageException('Missing CloudEvents data object');
        }
        $opt = static fn (string $key): ?string => isset($payload[$key]) && is_string($payload[$key]) ? $payload[$key] : null;

        return new self(
            $payload['id'],
            $payload['type'],
            $payload['source'],
            $opt('time'),
            $opt('subject'),
            $opt('correlationid'),
            $opt('causationid'),
            $opt('sagaid'),
            $opt('traceparent'),
            $payload['data'],
        );
    }
}
