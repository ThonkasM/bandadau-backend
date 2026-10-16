<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Shared\Telemetry;

use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\Propagation\TraceContextPropagator;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\Context\Context;
use OpenTelemetry\Contrib\Otlp\OtlpHttpTransportFactory;
use OpenTelemetry\Contrib\Otlp\SpanExporter;
use OpenTelemetry\SDK\Common\Attribute\Attributes;
use OpenTelemetry\SDK\Common\Time\ClockFactory;
use OpenTelemetry\SDK\Resource\ResourceInfo;
use OpenTelemetry\SDK\Resource\ResourceInfoFactory;
use OpenTelemetry\SDK\Sdk;
use OpenTelemetry\SDK\Trace\Sampler\AlwaysOnSampler;
use OpenTelemetry\SDK\Trace\Sampler\ParentBased;
use OpenTelemetry\SDK\Trace\SpanProcessor\BatchSpanProcessor;
use OpenTelemetry\SDK\Trace\TracerProvider;
use Throwable;

/**
 * Optional OTLP/HTTP trace export (R-4). Off unless an endpoint is configured and OTEL_SDK_DISABLED is not true; when
 * off, the OpenTelemetry API hands out no-op spans, so call sites cost nothing and need no `if`.
 *
 * Export is best effort: short timeout, no retries, and failures never reach the request or the consumer.
 */
final class Telemetry
{
    private static ?TracerProvider $provider = null;

    /**
     * @param  array<string, string>  $resourceAttributes  from OTEL_RESOURCE_ATTRIBUTES
     */
    public static function boot(bool $enabled, string $endpoint, string $serviceName, array $resourceAttributes = []): void
    {
        if (! $enabled || $endpoint === '' || self::$provider !== null) {
            return;
        }

        try {
            $transport = (new OtlpHttpTransportFactory)->create(
                rtrim($endpoint, '/').'/v1/traces',
                'application/x-protobuf',
                [],
                null,
                1.0,
                50,
                0,
            );
            $processor = new BatchSpanProcessor(new SpanExporter($transport), ClockFactory::getDefault());
            $resource = ResourceInfoFactory::emptyResource()->merge(ResourceInfo::create(Attributes::create(
                ['service.name' => $serviceName] + $resourceAttributes,
            )));
            self::$provider = new TracerProvider($processor, new ParentBased(new AlwaysOnSampler), $resource);
            // Registers the shutdown handler that flushes pending spans when the PHP-FPM request / CLI process ends.
            Sdk::builder()->setTracerProvider(self::$provider)->setPropagator(TraceContextPropagator::getInstance())
                ->setAutoShutdown(true)->buildAndRegisterGlobal();
        } catch (Throwable) {
            self::$provider = null; // never break the service because of telemetry
        }
    }

    /**
     * Starts a span as a child of the given W3C traceparent (if any) and makes it current until {@see Span::end()}.
     *
     * @param  non-empty-string  $name
     * @param  0|1|2|3|4  $kind
     * @param  array<non-empty-string, bool|int|float|string>  $attributes
     */
    public static function start(string $name, int $kind = SpanKind::KIND_INTERNAL, ?string $traceparent = null, array $attributes = []): Span
    {
        $builder = Globals::tracerProvider()->getTracer('bandada.notification')->spanBuilder($name)->setSpanKind($kind);
        $parent = $traceparent !== null
            ? TraceContextPropagator::getInstance()->extract(['traceparent' => $traceparent])
            : Context::getCurrent();
        $builder->setParent($parent);
        $span = $builder->startSpan();
        foreach ($attributes as $k => $v) {
            $span->setAttribute($k, $v);
        }

        return new Span($span, $span->storeInContext($parent)->activate());
    }

    /** Sends pending spans now (long-running consumer). */
    public static function flush(): void
    {
        try {
            self::$provider?->forceFlush();
        } catch (Throwable) {
        }
    }

    /** Test hook. */
    public static function reset(): void
    {
        self::$provider = null;
    }
}
