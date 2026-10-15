<?php

use Illuminate\Support\Facades\Http;
use Tests\Support\ApiHelpers;
use Tests\Support\Mailpit;
use Tests\Support\RabbitHarness;

uses(ApiHelpers::class);

beforeEach(function () {
    $this->mq = new RabbitHarness($this->app);
    Mailpit::clear();
    Http::fake(['exp.host/*' => Http::response(['data' => [['status' => 'ok']]])]);
});

function registered(string $user, string $locale = 'es', ?string $email = null): array
{
    return ['userId' => $user, 'email' => $email ?? $user.'@umsa.edu.bo', 'universityId' => '0192a000-0000-7000-8000-000000000001', 'displayName' => 'Lucía', 'roles' => ['STUDENT'], 'locale' => $locale];
}

it('turns a registration.confirmed event into an in-app notification, an email in Mailpit and a push', function () {
    $user = $this->newUser();
    $this->mq->event('bandada.identity.user.registered.v1', registered($user, 'es', 'lucia@umsa.edu.bo'));
    $this->putJson('/api/v1/devices/'.rawurlencode('ExponentPushToken[lucia-device-1]'), ['platform' => 'IOS'], $this->auth($user))->assertOk();
    $this->mq->event('bandada.events.registration.confirmed.v1', [
        'registrationId' => '0192a3bf-aaaa-7bbb-8ccc-000000000777', 'eventId' => '0192a3be-1234-7abc-8def-000000000042', 'userId' => $user,
        'sagaId' => '0192a3be-5a6a-7000-8000-000000000001', 'eventTitle' => 'Taller de Docker para principiantes', 'eventStartsAt' => '2026-10-20T22:00:00Z',
        'ticketId' => '0192a3c5-7777-7aaa-8bbb-000000000101', 'priceCredits' => 15,
    ]);

    $this->mq->consume(2);

    $items = $this->getJson('/api/v1/notifications', $this->auth($user))->assertOk()->assertHeader('X-Unread-Count', '2')->json('items');
    expect(array_column($items, 'type'))->toBe(['REGISTRATION_CONFIRMED', 'WELCOME'])
        ->and($items[0]['title'])->toBe('¡Inscripción confirmada!')
        ->and($items[0]['body'])->toBe('Ya tienes tu entrada para «Taller de Docker para principiantes».')
        ->and($items[0]['data']['deepLink'])->toBe('http://app.bandada.localhost/tickets/0192a3c5-7777-7aaa-8bbb-000000000101');

    $messages = Mailpit::messages();
    expect($messages)->toHaveCount(1)->and($messages[0]['To'][0]['Address'])->toBe('lucia@umsa.edu.bo')->and($messages[0]['Subject'])->toBe('¡Inscripción confirmada!');
    $mail = Mailpit::message($messages[0]['ID']);
    expect($mail['HTML'])->toContain('Taller de Docker para principiantes')->and($mail['HTML'])->toContain('Abrir en Bandada U');

    Http::assertSent(fn ($request) => str_contains($request->url(), 'exp.host') && $request[0]['to'] === 'ExponentPushToken[lucia-device-1]' && $request[0]['data']->type === 'REGISTRATION_CONFIRMED');
});

it('a duplicated message (same id) creates one notification, one email and one push', function () {
    $user = $this->newUser();
    $this->mq->event('bandada.identity.user.registered.v1', registered($user, 'es', 'dup@umsa.edu.bo'));
    $this->putJson('/api/v1/devices/'.rawurlencode('ExponentPushToken[dup-device-0001]'), ['platform' => 'IOS'], $this->auth($user))->assertOk();
    $data = ['registrationId' => '0192a3bf-aaaa-7bbb-8ccc-000000000777', 'eventId' => 'e', 'userId' => $user, 'eventTitle' => 'Taller', 'ticketId' => 't'];
    $id = $this->mq->event('bandada.events.registration.confirmed.v1', $data);
    $this->mq->event('bandada.events.registration.confirmed.v1', $data, $id);

    $this->mq->consume(3);

    $this->getJson('/api/v1/notifications', $this->auth($user))->assertOk()->assertJsonCount(2, 'items')->assertHeader('X-Unread-Count', '2');
    expect(Mailpit::messages())->toHaveCount(1);
    expect(Http::recorded(fn ($request) => str_contains($request->url(), 'exp.host')))->toHaveCount(1);
});

it('silences channels according to the preferences of the user', function () {
    $user = $this->newUser();
    $this->mq->event('bandada.identity.user.registered.v1', registered($user, 'es', 'quiet@umsa.edu.bo'));
    $this->putJson('/api/v1/notifications/preferences', ['channels' => ['push' => true, 'email' => false, 'inApp' => true], 'mutedTypes' => ['NEW_COMMENT']], $this->auth($user))->assertOk();
    $this->mq->event('bandada.social.comment.created.v1', ['commentId' => 'c1', 'postId' => 'p1', 'postAuthorId' => $user, 'authorId' => $this->newUser()]);   // muted
    $this->mq->event('bandada.wallet.topup.paid.v1', ['topUpId' => 't1', 'userId' => $user, 'package' => 'CREDITS_50', 'amountCredits' => 50, 'gatewayRef' => 'g', 'ledgerEntryId' => 'l', 'balanceCredits' => 50]);   // email off

    $this->mq->consume(3);

    $items = $this->getJson('/api/v1/notifications', $this->auth($user))->assertOk()->json('items');
    expect(array_column($items, 'type'))->toBe(['TOPUP_PAID', 'WELCOME'])->and(Mailpit::messages())->toBeEmpty();
});

it('renders in English after preferences-changed and keeps older notifications in Spanish', function () {
    $user = $this->newUser();
    $this->mq->event('bandada.identity.user.registered.v1', registered($user, 'es', 'bi@umsa.edu.bo'));
    $this->mq->consume(1);
    $this->mq->event('bandada.identity.user.preferences-changed.v1', ['userId' => $user, 'locale' => 'en', 'theme' => 'DARK', 'occurredAt' => gmdate('Y-m-d\TH:i:s\Z', time() + 5)]);
    $this->mq->event('bandada.wallet.topup.paid.v1', ['topUpId' => 't1', 'userId' => $user, 'package' => 'CREDITS_20', 'amountCredits' => 20, 'gatewayRef' => 'g', 'ledgerEntryId' => 'l', 'balanceCredits' => 20]);
    $this->mq->consume(2);

    $items = $this->getJson('/api/v1/notifications', $this->auth($user))->assertOk()->json('items');
    expect($items[0]['title'])->toBe('Top-up credited')->and($items[0]['locale'])->toBe('en')
        ->and($items[1]['title'])->toBe('¡Bienvenido a Bandada U!')->and($items[1]['locale'])->toBe('es');
    expect(Mailpit::message(Mailpit::messages()[0]['ID'])['Subject'])->toBe('Top-up credited');
});

it('groups reactions to the same post and skips self-reactions', function () {
    $author = $this->newUser();
    $react = fn (string $who) => ['postId' => 'p9', 'postAuthorId' => $author, 'userId' => $who, 'type' => 'LIKE', 'previousType' => null];
    $this->mq->event('bandada.social.reaction.set.v1', $react($this->newUser()));
    $this->mq->event('bandada.social.reaction.set.v1', $react($this->newUser()));
    $this->mq->event('bandada.social.reaction.set.v1', $react($author));

    $this->mq->consume(3);

    $this->getJson('/api/v1/notifications', $this->auth($author))->assertOk()->assertJsonCount(1, 'items');
});

it('ignores events nobody must be told about and sends malformed messages to the DLQ', function () {
    $this->mq->event('bandada.social.post.created.v1', ['postId' => 'p', 'authorId' => $this->newUser()]);
    $this->mq->raw('{oops', 'bandada.social.post.created.v1');
    $this->mq->consume(2);
    usleep(500_000);

    expect($this->mq->depth('notification-service.events.dlq'))->toBe(1)->and($this->mq->depth('notification-service.events'))->toBe(0);
});

it('notifies group admins and deletes nothing else', function () {
    [$a1, $a2, $requester] = [$this->newUser(), $this->newUser(), $this->newUser()];
    $this->mq->event('bandada.social.group.join-requested.v1', ['groupId' => 'g1', 'groupName' => 'Algoritmos', 'privacy' => 'PRIVATE', 'userId' => $requester, 'membershipStatus' => 'PENDING', 'groupAdminIds' => [$a1, $a2]]);
    $this->mq->consume(1);

    foreach ([$a1, $a2] as $admin) {
        $this->getJson('/api/v1/notifications', $this->auth($admin))->assertOk()->assertJsonPath('items.0.type', 'GROUP_REQUEST')->assertJsonPath('items.0.body', 'Alguien quiere unirse a «Algoritmos».');
    }
    $this->getJson('/api/v1/notifications', $this->auth($requester))->assertOk()->assertJsonCount(0, 'items');
});
