<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Shared\Telemetry;

use OpenTelemetry\API\Trace\SpanInterface;
use OpenTelemetry\API\Trace\StatusCode;
use OpenTelemetry\Context\ScopeInterface;
use Throwable;

/** Active span handle: `end()` detaches the scope and closes the span (idempotent). */
final class Span
{
    private bool $ended = false;

    public function __construct(private readonly SpanInterface $span, private readonly ScopeInterface $scope) {}

    /** @param non-empty-string $key */
    public function setAttribute(string $key, bool|int|float|string $value): void
    {
        $this->span->setAttribute($key, $value);
    }

    public function fail(Throwable $e): void
    {
        $this->span->recordException($e);
        $this->span->setStatus(StatusCode::STATUS_ERROR, $e->getMessage());
    }

    public function end(): void
    {
        if ($this->ended) {
            return;
        }
        $this->ended = true;
        $this->scope->detach();
        $this->span->end();
    }
}
