<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Http\Problem;

use Bandada\Wallet\Adapter\Shared\Exception\DependencyUnavailableException;
use Bandada\Wallet\Adapter\Shared\Logging\LogContext;
use Bandada\Wallet\Domain\Exception\DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Lang;
use Psr\Log\LoggerInterface;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

final readonly class ProblemDetailsRenderer
{
    public function __construct(private LoggerInterface $logger) {}

    public function render(Throwable $e, Request $request): JsonResponse
    {
        $locale = (string) $request->attributes->get('locale', 'es');
        $headers = [];
        $params = [];
        $errors = [];

        if ($e instanceof ProblemException) {
            $code = $e->problemCode;
            $params = $e->params;
            $errors = $e->errors;
            $headers = $e->headers;
        } elseif ($e instanceof DomainException) {
            $code = $e->errorCode();
            $params = $e->params();
        } elseif ($e instanceof DependencyUnavailableException) {
            $code = 'DEPENDENCY_UNAVAILABLE';
            $headers = ['Retry-After' => '5'];
            $this->logger->error('Dependency unavailable', ['event' => 'dependency.unavailable', 'error' => $e->getMessage()]);
        } elseif ($e instanceof HttpExceptionInterface) {
            $code = match ($e->getStatusCode()) {
                404 => 'NOT_FOUND',
                405 => 'METHOD_NOT_ALLOWED',
                415 => 'UNSUPPORTED_MEDIA_TYPE',
                429 => 'RATE_LIMITED',
                default => $e->getStatusCode() >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED',
            };
            $headers = $e->getHeaders();
        } else {
            $code = 'INTERNAL_ERROR';
            $this->logger->error('Unhandled exception', [
                'event' => 'http.unhandled_exception', 'exception' => $e::class, 'error' => $e->getMessage(),
                'file' => $e->getFile().':'.$e->getLine(),
            ]);
        }

        $status = ProblemCatalog::status($code);
        $body = [
            'type' => ProblemCatalog::type($code),
            'title' => $this->text($code, 'title', $params, $locale),
            'status' => $status,
            'detail' => $this->text($code, 'detail', $params, $locale),
            'instance' => '/'.ltrim($request->path(), '/'),
            'code' => $code,
        ];
        $traceId = LogContext::traceId();
        if ($traceId !== null) {
            $body['traceId'] = $traceId;
        }
        if ($errors !== []) {
            $body['errors'] = $errors;
        }

        return new JsonResponse($body, $status, $headers + ['Content-Type' => 'application/problem+json']);
    }

    /** @param array<string, scalar|null> $params */
    private function text(string $code, string $part, array $params, string $locale): string
    {
        $key = "problems.{$code}.{$part}";
        if (! Lang::has($key, $locale)) {
            $key = "problems.INTERNAL_ERROR.{$part}";
        }

        return (string) Lang::get($key, $params, $locale);
    }
}
