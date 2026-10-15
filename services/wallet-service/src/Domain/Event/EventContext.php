<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Event;

/** Tracing/correlation metadata that travels with an event (CloudEvents extensions). */
final readonly class EventContext
{
    public function __construct(
        public ?string $correlationId = null,
        public ?string $causationId = null,
        public ?string $sagaId = null,
        public ?string $traceparent = null,
    ) {}

    public static function none(): self
    {
        return new self;
    }
}
