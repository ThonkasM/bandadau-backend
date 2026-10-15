<?php

use Illuminate\Support\Facades\Http;
use Tests\Support\ApiHelpers;

uses(ApiHelpers::class);

function payload(array $users, array $extra = []): array
{
    return $extra + [
        'userIds' => $users, 'type' => 'EVENT_REMINDER', 'dedupeKey' => 'reminder:evt-1',
        'params' => ['eventTitle' => 'Taller de Docker', 'startsAt' => '2026-10-20T22:00:00Z', 'venue' => 'Auditorio UMSA'],
        'data' => ['deepLink' => 'bandada://events/1', 'eventId' => '0192a3be-1234-7abc-8def-000000000042'],
    ];
}

it('needs a service token with internal:write and an Idempotency-Key', function () {
    $key = ['Idempotency-Key' => $this->newUser()];
    $this->postJson('/internal/v1/notifications', payload([$this->newUser()]), $key)->assertStatus(401);
    $this->postJson('/internal/v1/notifications', payload([$this->newUser()]), $key + $this->auth($this->newUser()))->assertStatus(403);
    $this->postJson('/internal/v1/notifications', payload([$this->newUser()]), $key + $this->service('internal:read'))->assertStatus(403);
    $this->postJson('/internal/v1/notifications', payload([$this->newUser()]), $this->service())->assertStatus(400)->assertJsonPath('code', 'IDEMPOTENCY_KEY_REQUIRED');
});

it('accepts a directed notification, renders it in the recipient locale and dedupes by dedupeKey', function () {
    Http::fake(['exp.host/*' => Http::response(['data' => [['status' => 'ok']]])]);
    [$ana, $bob] = [$this->newUser(), $this->newUser()];

    $first = $this->postJson('/internal/v1/notifications', payload([$ana, $bob]), ['Idempotency-Key' => $this->newUser()] + $this->service());
    $other = $this->postJson('/internal/v1/notifications', payload([$ana, $bob]), ['Idempotency-Key' => $this->newUser()] + $this->service());

    $first->assertStatus(202)->assertExactJson(['accepted' => 2, 'skipped' => 0]);
    $other->assertStatus(202)->assertExactJson(['accepted' => 0, 'skipped' => 2]);   // same dedupeKey, different Idempotency-Key
    $items = $this->getJson('/api/v1/notifications', $this->auth($ana))->assertOk()->assertJsonCount(1, 'items')->json('items');
    expect($items[0]['type'])->toBe('EVENT_REMINDER')->and($items[0]['body'])->toContain('Taller de Docker')->and($items[0]['data']['eventId'])->toBe('0192a3be-1234-7abc-8def-000000000042');
});

it('replays the response for the same Idempotency-Key and rejects a different body', function () {
    $user = $this->newUser();
    $key = ['Idempotency-Key' => $this->newUser()] + $this->service();

    $one = $this->postJson('/internal/v1/notifications', payload([$user], ['dedupeKey' => 'k1']), $key);
    $two = $this->postJson('/internal/v1/notifications', payload([$user], ['dedupeKey' => 'k1']), $key);
    $three = $this->postJson('/internal/v1/notifications', payload([$user], ['dedupeKey' => 'k2']), $key);

    $two->assertStatus(202)->assertHeader('Idempotent-Replayed', 'true')->assertExactJson($one->json());
    $three->assertStatus(422)->assertJsonPath('code', 'IDEMPOTENCY_KEY_REUSED');
});

it('skips recipients who silenced the type and honours the channel filter', function () {
    $quiet = $this->newUser();
    $this->putJson('/api/v1/notifications/preferences', ['channels' => ['push' => true, 'email' => true, 'inApp' => true], 'mutedTypes' => ['EVENT_REMINDER']], $this->auth($quiet))->assertOk();

    $this->postJson('/internal/v1/notifications', payload([$quiet], ['dedupeKey' => 'k3']), ['Idempotency-Key' => $this->newUser()] + $this->service())
        ->assertStatus(202)->assertExactJson(['accepted' => 0, 'skipped' => 1]);
    $this->postJson('/internal/v1/notifications', payload([$this->newUser()], ['channels' => ['SMS']]), ['Idempotency-Key' => $this->newUser()] + $this->service())->assertStatus(400);
    $this->postJson('/internal/v1/notifications', payload([]), ['Idempotency-Key' => $this->newUser()] + $this->service())->assertStatus(400);
});

it('reports liveness and readiness', function () {
    $this->getJson('/health/live')->assertOk();
    $this->getJson('/health/ready')->assertOk()->assertJsonPath('checks.dynamodb', 'UP')->assertJsonPath('checks.rabbitmq', 'UP');
});
