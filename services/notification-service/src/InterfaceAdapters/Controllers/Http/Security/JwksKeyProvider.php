<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Controllers\Http\Security;

use Bandada\Notification\InterfaceAdapters\Shared\Exception\DependencyUnavailableException;
use Firebase\JWT\JWK;
use Firebase\JWT\Key;
use Illuminate\Contracts\Cache\Repository as Cache;
use Illuminate\Http\Client\Factory as Http;
use Throwable;

/**
 * JWKS cache (seguridad-y-sso.md 2.2): keys are cached for `ttl` seconds; an unknown `kid` forces one
 * refresh at most every `minRefreshInterval` seconds; a stale copy is kept if identity is unreachable.
 */
final readonly class JwksKeyProvider
{
    private const string FRESH = 'jwks.keys';

    private const string STALE = 'jwks.stale';

    private const string LAST_REFRESH = 'jwks.refreshed_at';

    public function __construct(
        private Cache $cache,
        private Http $http,
        private string $url,
        private int $ttlSeconds,
        private int $minRefreshInterval,
    ) {}

    /** @return array<string, Key> */
    public function keys(bool $forceRefresh = false): array
    {
        $jwks = $forceRefresh ? null : $this->cache->get(self::FRESH);
        if (! is_array($jwks)) {
            $jwks = $this->refresh($forceRefresh) ?? $this->cache->get(self::STALE);
        }
        if (! is_array($jwks)) {
            throw new DependencyUnavailableException('JWKS unavailable');
        }

        return JWK::parseKeySet($this->onlyRsa($jwks), 'RS256');
    }

    /** @return array<string, mixed>|null */
    private function refresh(bool $forced): ?array
    {
        $last = (int) $this->cache->get(self::LAST_REFRESH, 0);
        if ($forced && time() - $last < $this->minRefreshInterval) {
            return null;
        }
        $this->cache->put(self::LAST_REFRESH, time(), 3600);
        try {
            $response = $this->http->timeout(3)->connectTimeout(2)->acceptJson()->get($this->url);
            $jwks = $response->successful() ? $response->json() : null;
        } catch (Throwable) {
            return null;
        }
        if (! is_array($jwks) || ! isset($jwks['keys']) || ! is_array($jwks['keys'])) {
            return null;
        }
        $this->cache->put(self::FRESH, $jwks, $this->ttlSeconds);
        $this->cache->forever(self::STALE, $jwks);

        return $jwks;
    }

    /**
     * @param  array<string, mixed>  $jwks
     * @return array{keys: list<mixed>}
     */
    private function onlyRsa(array $jwks): array
    {
        $keys = array_values(array_filter(
            is_array($jwks['keys'] ?? null) ? $jwks['keys'] : [],
            static fn (mixed $k): bool => is_array($k) && ($k['kty'] ?? null) === 'RSA' && isset($k['kid']),
        ));

        return ['keys' => $keys];
    }
}
