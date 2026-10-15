<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Http\Middleware;

use Bandada\Wallet\Adapter\In\Http\Support\LocaleResolver;
use Bandada\Wallet\Adapter\Shared\Logging\LogContext;
use Bandada\Wallet\Adapter\Shared\Messaging\Traceparent;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Str;
use Psr\Log\LoggerInterface;
use Symfony\Component\HttpFoundation\Response;

/** Correlation id, W3C traceparent and locale for every request; one JSON access-log line per request. */
final class RequestContext
{
    private float $startedAt = 0.0;

    public function __construct(private readonly LoggerInterface $logger) {}

    public function handle(Request $request, Closure $next): Response
    {
        $this->startedAt = microtime(true);
        $incoming = $request->header('X-Correlation-Id');
        $correlationId = is_string($incoming) && Str::isUuid($incoming) ? strtolower($incoming) : Str::uuid7()->toString();
        $incomingTrace = $request->header('traceparent');
        $traceparent = is_string($incomingTrace) && Traceparent::isValid($incomingTrace) ? $incomingTrace : Traceparent::generate();
        $locale = LocaleResolver::resolve($request->header('Accept-Language'));

        $request->attributes->set('correlationId', $correlationId);
        $request->attributes->set('traceparent', $traceparent);
        $request->attributes->set('locale', $locale);
        LogContext::set($correlationId, Traceparent::traceId($traceparent));
        App::setLocale($locale);

        $response = $next($request);
        $response->headers->set('X-Correlation-Id', $correlationId);
        $response->headers->set('Content-Language', $locale);

        return $response;
    }

    public function terminate(Request $request, Response $response): void
    {
        $path = '/'.ltrim($request->path(), '/');
        if (! str_starts_with($path, '/health')) {
            $this->logger->info('HTTP request', [
                'event' => 'http.request',
                'method' => $request->method(),
                'path' => $path,
                'status' => $response->getStatusCode(),
                'durationMs' => (int) round((microtime(true) - $this->startedAt) * 1000),
            ]);
        }
        LogContext::clear();
    }
}
