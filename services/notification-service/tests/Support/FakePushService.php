<?php

declare(strict_types=1);

namespace Tests\Support;

use GuzzleHttp\Psr7\Response;
use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;

/** Simulated browser push service (PSR-18): answers per endpoint and records the requests the VAPID sender made. */
final class FakePushService implements ClientInterface
{
    /** @var list<RequestInterface> */
    public array $requests = [];

    /** @param array<string, int> $statusByEndpoint default 201 */
    public function __construct(private array $statusByEndpoint = []) {}

    public function sendRequest(RequestInterface $request): ResponseInterface
    {
        $this->requests[] = $request;

        return new Response($this->statusByEndpoint[(string) $request->getUri()] ?? 201);
    }
}
