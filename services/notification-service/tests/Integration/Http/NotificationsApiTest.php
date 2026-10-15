<?php

use Bandada\Notification\Entities\NotificationType;
use Bandada\Notification\UseCases\Ports\DeviceRepository;
use Tests\Support\ApiHelpers;
use Tests\Support\TestJwt;

uses(ApiHelpers::class);

it('requires authentication and answers Problem Details in the requested language', function () {
    $this->getJson('/api/v1/notifications')->assertStatus(401)->assertHeader('Content-Type', 'application/problem+json')->assertJsonPath('code', 'UNAUTHORIZED')->assertJsonPath('title', 'No autenticado');
    $this->getJson('/api/v1/notifications', ['Accept-Language' => 'en'])->assertStatus(401)->assertJsonPath('title', 'Not authenticated')->assertHeader('Content-Language', 'en');
    $this->getJson('/api/v1/notifications', ['Authorization' => 'Bearer '.TestJwt::token(['exp' => time() - 100])])->assertStatus(401);
    $this->getJson('/api/v1/notifications', ['Authorization' => 'Bearer '.TestJwt::serviceToken()])->assertStatus(401);
});

it('lists newest first with cursor pagination, X-Unread-Count and unreadOnly', function () {
    $user = $this->newUser();
    $ids = array_map(fn () => $this->seedNotification($user)->id, range(1, 5));

    $p1 = $this->getJson('/api/v1/notifications?limit=2', $this->auth($user));
    $p1->assertOk()->assertHeader('X-Unread-Count', '5')->assertJsonCount(2, 'items')->assertJsonPath('items.0.id', $ids[4])
        ->assertJsonStructure(['items' => [['id', 'userId', 'type', 'title', 'body', 'locale', 'data', 'readAt', 'createdAt']], 'nextCursor']);
    $p2 = $this->getJson('/api/v1/notifications?limit=2&cursor='.$p1->json('nextCursor'), $this->auth($user));
    $p3 = $this->getJson('/api/v1/notifications?limit=2&cursor='.$p2->json('nextCursor'), $this->auth($user));

    $p2->assertOk()->assertJsonPath('items.0.id', $ids[2]);
    $p3->assertOk()->assertJsonCount(1, 'items')->assertJsonPath('nextCursor', null);

    $this->postJson("/api/v1/notifications/{$ids[4]}/read", [], $this->auth($user))->assertOk();
    $this->getJson('/api/v1/notifications?unreadOnly=true&limit=10', $this->auth($user))
        ->assertOk()->assertJsonCount(4, 'items')->assertHeader('X-Unread-Count', '4');
    $this->getJson('/api/v1/notifications?cursor=garbage', $this->auth($user))->assertStatus(400)->assertJsonPath('code', 'INVALID_CURSOR');
    $this->getJson('/api/v1/notifications?limit=99', $this->auth($user))->assertStatus(400)->assertJsonPath('code', 'VALIDATION_FAILED');
});

it('renders title and body from type and params in the notification locale', function () {
    $user = $this->newUser();
    $this->seedNotification($user, NotificationType::TopUpPaid, ['amountCredits' => 1500, 'balanceCredits' => 1600], 'en');
    $this->seedNotification($user, NotificationType::RegistrationFailed, ['eventTitle' => 'Taller de Docker', 'reason' => 'INSUFFICIENT_FUNDS'], 'es');

    $items = $this->getJson('/api/v1/notifications', $this->auth($user))->assertOk()->json('items');

    expect($items[0]['title'])->toBe('No pudimos completar tu inscripción')
        ->and($items[0]['body'])->toContain('recarga créditos')->and($items[0]['body'])->toContain('Taller de Docker')
        ->and($items[1]['title'])->toBe('Top-up credited')
        ->and($items[1]['body'])->toBe('1,500 credits were added. Your balance is 1,600.')
        ->and($items[1]['locale'])->toBe('en');
});

it('marks one as read idempotently and 404s on other peoples notifications', function () {
    $user = $this->newUser();
    $n = $this->seedNotification($user);

    $first = $this->postJson("/api/v1/notifications/{$n->id}/read", [], $this->auth($user));
    usleep(20000);
    $second = $this->postJson("/api/v1/notifications/{$n->id}/read", [], $this->auth($user));

    $first->assertOk()->assertJsonPath('id', $n->id);
    expect($first->json('readAt'))->not->toBeNull()->and($second->json('readAt'))->toBe($first->json('readAt'));
    $this->getJson('/api/v1/notifications', $this->auth($user))->assertHeader('X-Unread-Count', '0');

    $this->postJson("/api/v1/notifications/{$n->id}/read", [], $this->auth($this->newUser()))->assertStatus(404)->assertJsonPath('code', 'NOTIFICATION_NOT_FOUND');
    $this->postJson('/api/v1/notifications/not-a-uuid/read', [], $this->auth($user))->assertStatus(400);
});

it('marks everything as read', function () {
    $user = $this->newUser();
    foreach (range(1, 5) as $_) {
        $this->seedNotification($user);
    }

    $this->postJson('/api/v1/notifications/read-all', [], $this->auth($user))->assertOk()->assertJsonPath('updatedCount', 5)->assertJsonStructure(['updatedCount', 'readAt']);
    $this->postJson('/api/v1/notifications/read-all', [], $this->auth($user))->assertOk()->assertJsonPath('updatedCount', 0);
    $this->getJson('/api/v1/notifications?unreadOnly=true', $this->auth($user))->assertOk()->assertJsonCount(0, 'items')->assertHeader('X-Unread-Count', '0');
});

it('returns default preferences, replaces them and refuses to mute ALERT', function () {
    $user = $this->newUser();

    $this->getJson('/api/v1/notifications/preferences', $this->auth($user))->assertOk()
        ->assertExactJsonStructure(['userId', 'channels' => ['push', 'email', 'inApp'], 'mutedTypes', 'updatedAt'])
        ->assertJsonPath('channels.email', true)->assertJsonPath('mutedTypes', []);

    $body = ['channels' => ['push' => true, 'email' => false, 'inApp' => true], 'mutedTypes' => ['NEW_REACTION']];
    $this->putJson('/api/v1/notifications/preferences', $body, $this->auth($user))->assertOk()->assertJsonPath('channels.email', false)->assertJsonPath('mutedTypes', ['NEW_REACTION']);
    $this->getJson('/api/v1/notifications/preferences', $this->auth($user))->assertJsonPath('mutedTypes', ['NEW_REACTION'])->assertJsonPath('channels.email', false);

    $this->putJson('/api/v1/notifications/preferences', ['channels' => $body['channels'], 'mutedTypes' => ['ALERT']], $this->auth($user))->assertStatus(422)->assertJsonPath('code', 'TYPE_NOT_MUTABLE');
    $this->putJson('/api/v1/notifications/preferences', ['channels' => ['push' => true], 'mutedTypes' => []], $this->auth($user))->assertStatus(400)->assertJsonPath('code', 'VALIDATION_FAILED');
    $this->putJson('/api/v1/notifications/preferences', $body + ['locale' => 'en'], $this->auth($user))->assertStatus(400);
    $this->putJson('/api/v1/notifications/preferences', ['channels' => $body['channels'], 'mutedTypes' => ['NEW_REACTION', 'NEW_REACTION']], $this->auth($user))->assertStatus(400);
});

it('registers devices idempotently, reassigns a token to the new owner and unregisters', function () {
    [$a, $b] = [$this->newUser(), $this->newUser()];
    $token = 'ExponentPushToken[xk2P9aLmQ0rT7vY3bN1c]';
    $url = '/api/v1/devices/'.rawurlencode($token);

    $first = $this->putJson($url, ['platform' => 'ANDROID', 'appVersion' => '1.4.0', 'deviceName' => 'Galaxy A54'], $this->auth($a));
    usleep(20000);
    $again = $this->putJson($url, ['platform' => 'ANDROID', 'appVersion' => '1.4.1'], $this->auth($a));

    $first->assertOk()->assertJsonPath('token', $token)->assertJsonPath('userId', $a)->assertJsonPath('platform', 'ANDROID');
    expect($again->json('registeredAt'))->toBe($first->json('registeredAt'))->and($again->json('appVersion'))->toBe('1.4.1');

    $this->putJson($url, ['platform' => 'IOS'], $this->auth($b))->assertOk()->assertJsonPath('userId', $b);
    $devices = app(DeviceRepository::class);
    expect($devices->forUser($a))->toBeEmpty()->and($devices->forUser($b))->toHaveCount(1);

    $this->deleteJson($url, [], $this->auth($a))->assertNoContent();   // not the owner: no effect, still 204
    expect($devices->forUser($b))->toHaveCount(1);
    $this->deleteJson($url, [], $this->auth($b))->assertNoContent();
    $this->deleteJson($url, [], $this->auth($b))->assertNoContent();
    expect($devices->forUser($b))->toBeEmpty();

    $this->putJson($url, ['platform' => 'PLAYSTATION'], $this->auth($a))->assertStatus(400);
    $this->putJson('/api/v1/devices/short', ['platform' => 'IOS'], $this->auth($a))->assertStatus(400);
});
