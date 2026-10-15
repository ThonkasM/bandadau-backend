<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Controllers\Http\Middleware;

use Bandada\Notification\InterfaceAdapters\Controllers\Http\Problem\ProblemException;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Security\Principal;
use Bandada\Notification\InterfaceAdapters\Shared\Idempotency\IdempotencyOutcome;
use Bandada\Notification\InterfaceAdapters\Shared\Idempotency\IdempotencyStore;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/** Idempotency-Key protocol of idempotencia.md section 2 (DynamoDB-backed). Must run after authentication. */
final readonly class EnsureIdempotency
{
    private const array REPLAYED_HEADERS = ['Content-Type', 'Location', 'Content-Language'];

    public function __construct(private IdempotencyStore $store) {}

    public function handle(Request $request, Closure $next): Response
    {
        $raw = $request->header('Idempotency-Key');
        if (! is_string($raw) || trim($raw) === '') {
            throw new ProblemException('IDEMPOTENCY_KEY_REQUIRED');
        }
        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', trim($raw)) !== 1) {
            throw new ProblemException('IDEMPOTENCY_KEY_INVALID');
        }
        $key = strtolower(trim($raw));
        $principal = $request->attributes->get('principal');
        $subject = $principal instanceof Principal ? $principal->subject : 'anonymous';

        $outcome = $this->store->reserve($key, $this->hash($request, $subject), $subject);
        switch ($outcome->kind) {
            case IdempotencyOutcome::REPLAY:
                $response = new Response($outcome->body, $outcome->status, $outcome->headers);
                $response->headers->set('Idempotent-Replayed', 'true');

                return $response;
            case IdempotencyOutcome::IN_PROGRESS:
                throw new ProblemException('IDEMPOTENCY_IN_PROGRESS', headers: ['Retry-After' => '1']);
            case IdempotencyOutcome::KEY_REUSED:
                throw new ProblemException('IDEMPOTENCY_KEY_REUSED');
        }

        try {
            $response = $next($request);
        } catch (Throwable $e) {
            $this->store->release($key);
            throw $e;
        }

        $status = $response->getStatusCode();
        if ($this->storable($status)) {
            $headers = [];
            foreach (self::REPLAYED_HEADERS as $name) {
                $value = $response->headers->get($name);
                if ($value !== null) {
                    $headers[$name] = $value;
                }
            }
            $headers['Content-Language'] ??= (string) $request->attributes->get('locale', 'es');
            $this->store->complete($key, $status, $headers, (string) $response->getContent());
        } else {
            $this->store->release($key);
        }
        $response->headers->set('Idempotent-Replayed', 'false');

        return $response;
    }

    /** 2xx and deterministic 4xx are saved; 401, 403, 429 and 5xx release the key so the client can retry. */
    private function storable(int $status): bool
    {
        if ($status >= 200 && $status < 300) {
            return true;
        }

        return $status >= 400 && $status < 500 && ! in_array($status, [401, 403, 429], true);
    }

    private function hash(Request $request, string $subject): string
    {
        $route = $request->route();
        $template = $route instanceof Route ? $route->uri() : $request->path();
        $params = $route instanceof Route ? $route->parameters() : [];
        ksort($params);

        $raw = (string) $request->getContent();
        $decoded = json_decode($raw, true);
        $body = $raw === '' ? '' : (json_last_error() === JSON_ERROR_NONE ? $this->canonical($decoded) : $raw);

        return hash('sha256', implode("\n", [
            $request->method(),
            $template,
            http_build_query($params),
            $subject,
            $body,
        ]));
    }

    private function canonical(mixed $value): string
    {
        return json_encode($this->sorted($value), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION) ?: '';
    }

    private function sorted(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        if (! array_is_list($value)) {
            ksort($value);
        }

        return array_map(fn (mixed $v): mixed => $this->sorted($v), $value);
    }
}
