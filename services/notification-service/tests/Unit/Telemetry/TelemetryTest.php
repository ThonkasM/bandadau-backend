<?php

declare(strict_types=1);

use Bandada\Notification\InterfaceAdapters\Shared\Telemetry\Telemetry;
use OpenTelemetry\API\Trace\SpanKind;

it('is a no-op while telemetry is disabled', function (): void {
    Telemetry::reset();
    Telemetry::boot(false, '', 'notification-service');

    $span = Telemetry::start('process x', SpanKind::KIND_CONSUMER, '00-'.str_repeat('a', 32).'-'.str_repeat('b', 16).'-01', ['k' => 'v']);
    $span->setAttribute('http.response.status_code', 200);
    $span->fail(new RuntimeException('boom'));
    $span->end();
    $span->end(); // idempotent
    Telemetry::flush();

    expect(true)->toBeTrue();
});

it('never breaks the caller when the collector is unreachable', function (): void {
    Telemetry::reset();
    Telemetry::boot(true, 'http://127.0.0.1:1', 'notification-service', ['deployment.environment' => 'test']);

    $span = Telemetry::start('GET /notifications', SpanKind::KIND_SERVER);
    $span->end();
    Telemetry::flush();
    Telemetry::reset();

    expect(true)->toBeTrue();
});
