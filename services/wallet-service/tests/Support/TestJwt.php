<?php

declare(strict_types=1);

namespace Tests\Support;

use Firebase\JWT\JWT;

/** Issues RS256 tokens like identity-service would and serves the matching JWKS. */
final class TestJwt
{
    public const KID = 'test-key-1';

    public const ISSUER = 'http://api.bandada.localhost';

    private static ?\OpenSSLAsymmetricKey $key = null;

    private static function key(): \OpenSSLAsymmetricKey
    {
        return self::$key ??= openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
    }

    /** @return array{keys: list<array<string,string>>} */
    public static function jwks(): array
    {
        $details = openssl_pkey_get_details(self::key());
        $b64 = static fn (string $bin): string => rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');

        return ['keys' => [[
            'kty' => 'RSA', 'use' => 'sig', 'alg' => 'RS256', 'kid' => self::KID,
            'n' => $b64($details['rsa']['n']), 'e' => $b64($details['rsa']['e']),
        ]]];
    }

    /** @param array<string, mixed> $claims */
    public static function token(array $claims = [], string $kid = self::KID): string
    {
        $now = time();
        $payload = array_merge([
            'iss' => self::ISSUER,
            'aud' => 'bandada-app',
            'sub' => '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b',
            'typ' => 'user',
            'roles' => ['STUDENT'],
            'iat' => $now,
            'exp' => $now + 900,
            'jti' => bin2hex(random_bytes(8)),
        ], $claims);

        openssl_pkey_export(self::key(), $pem);

        return JWT::encode($payload, $pem, 'RS256', $kid);
    }

    public static function userToken(string $userId = '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b', string $aud = 'bandada-app'): string
    {
        return self::token(['sub' => $userId, 'aud' => $aud]);
    }

    public static function serviceToken(string $scope = 'internal:read'): string
    {
        return self::token(['sub' => 'service:admin-gateway', 'typ' => 'service', 'aud' => 'bandada-internal', 'scope' => $scope, 'roles' => []]);
    }
}
