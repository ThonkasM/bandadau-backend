<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Http\Security;

use Bandada\Wallet\Adapter\Shared\Exception\DependencyUnavailableException;
use Firebase\JWT\JWT;
use stdClass;
use Throwable;

/** RS256-only verification against the identity-service JWKS (iss, exp/nbf with leeway). */
final readonly class JwtVerifier
{
    public function __construct(
        private JwksKeyProvider $keys,
        private string $issuer,
        private int $leewaySeconds,
    ) {}

    /**
     * @return array{claims: stdClass, principal: Principal}|null null when the token is not valid
     */
    public function verify(string $jwt): ?array
    {
        $parts = explode('.', $jwt);
        if (count($parts) !== 3) {
            return null;
        }
        try {
            $header = json_decode(JWT::urlsafeB64Decode($parts[0]), false, 8, JSON_THROW_ON_ERROR);
            if (! $header instanceof stdClass || ($header->alg ?? null) !== 'RS256' || ! is_string($header->kid ?? null)) {
                return null;
            }
            $keys = $this->keys->keys();
            if (! isset($keys[$header->kid])) {
                $keys = $this->keys->keys(forceRefresh: true);
            }
            if (! isset($keys[$header->kid])) {
                return null;
            }
            JWT::$leeway = $this->leewaySeconds;
            $claims = JWT::decode($jwt, $keys);
        } catch (Throwable $e) {
            if ($e instanceof DependencyUnavailableException) {
                throw $e;
            }

            return null;
        }

        if (($claims->iss ?? null) !== $this->issuer || ! isset($claims->exp, $claims->sub) || ! is_string($claims->sub)) {
            return null;
        }

        return ['claims' => $claims, 'principal' => new Principal(
            $claims->sub,
            is_string($claims->typ ?? null) ? $claims->typ : 'user',
            $this->stringList($claims->roles ?? []),
            $this->scopes($claims->scope ?? ''),
            is_string($claims->locale ?? null) ? $claims->locale : null,
        )];
    }

    /** @return list<string> */
    private function stringList(mixed $value): array
    {
        return is_array($value) ? array_values(array_filter($value, 'is_string')) : [];
    }

    /** @return list<string> */
    private function scopes(mixed $value): array
    {
        return is_string($value) ? array_values(array_filter(explode(' ', $value))) : $this->stringList($value);
    }
}
