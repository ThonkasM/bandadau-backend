<?php

use Firebase\JWT\JWT;
use Tests\Support\ApiHelpers;
use Tests\Support\TestJwt;

uses(ApiHelpers::class);

it('rejects requests without a token with a localized Problem Details body', function () {
    $es = $this->getJson('/api/v1/wallet/me');
    $en = $this->getJson('/api/v1/wallet/me', ['Accept-Language' => 'en-US,en;q=0.9,es;q=0.8']);

    $es->assertStatus(401)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertHeader('Content-Language', 'es')
        ->assertHeader('WWW-Authenticate', 'Bearer error="invalid_token"')
        ->assertJsonPath('code', 'UNAUTHORIZED')
        ->assertJsonPath('type', 'https://api.bandadau.com/problems/unauthorized')
        ->assertJsonPath('title', 'No autenticado');
    $en->assertStatus(401)->assertHeader('Content-Language', 'en')->assertJsonPath('title', 'Not authenticated');
});

it('rejects tokens that are expired, wrong audience, wrong issuer, unknown kid, HS256 or the service type', function (array $headers) {
    $this->getJson('/api/v1/wallet/me', $headers)->assertStatus(401)->assertJsonPath('code', 'UNAUTHORIZED');
})->with(function () {
    return [
        'expired' => fn () => ['Authorization' => 'Bearer '.TestJwt::token(['exp' => time() - 120])],
        'audience' => fn () => ['Authorization' => 'Bearer '.TestJwt::token(['aud' => 'bandada-other'])],
        'issuer' => fn () => ['Authorization' => 'Bearer '.TestJwt::token(['iss' => 'http://evil.example'])],
        'unknown kid' => fn () => ['Authorization' => 'Bearer '.TestJwt::token([], 'unknown-kid')],
        'HS256' => fn () => ['Authorization' => 'Bearer '.JWT::encode(['iss' => TestJwt::ISSUER, 'aud' => 'bandada-app', 'sub' => 'x', 'exp' => time() + 60], str_repeat('k', 40), 'HS256', TestJwt::KID)],
        'service token on a user route' => fn () => ['Authorization' => 'Bearer '.TestJwt::serviceToken()],
        'garbage' => fn () => ['Authorization' => 'Bearer not.a.jwt'],
    ];
});

it('accepts admin-audience user tokens and echoes the correlation id', function () {
    $id = '0192f3c0-1234-7abc-8def-0123456789ab';

    $this->getJson('/api/v1/wallet/me', ['Authorization' => 'Bearer '.TestJwt::userToken(self::USER, 'bandada-admin'), 'X-Correlation-Id' => $id])
        ->assertOk()
        ->assertHeader('X-Correlation-Id', $id);
});

it('answers unknown routes and wrong methods as Problem Details', function () {
    $this->getJson('/api/v1/wallet/nope')->assertStatus(404)->assertJsonPath('code', 'NOT_FOUND');
    $this->deleteJson('/api/v1/wallet/me', [], $this->auth())->assertStatus(405)->assertJsonPath('code', 'METHOD_NOT_ALLOWED');
});

it('reports liveness and readiness', function () {
    $this->getJson('/health/live')->assertOk()->assertJsonPath('status', 'UP');
    $this->getJson('/health/ready')->assertOk()->assertJsonPath('status', 'UP')
        ->assertJsonPath('checks.database', 'UP')->assertJsonPath('checks.rabbitmq', 'UP')->assertJsonPath('checks.idempotencyStore', 'UP');
});
