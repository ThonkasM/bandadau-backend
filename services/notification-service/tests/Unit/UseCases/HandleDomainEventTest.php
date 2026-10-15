<?php

use Bandada\Notification\Entities\ChannelSet;
use Bandada\Notification\Entities\DeliveryStatus;
use Bandada\Notification\Entities\DevicePlatform;
use Bandada\Notification\Entities\DeviceToken;
use Bandada\Notification\Entities\NotificationType;
use Bandada\Notification\UseCases\Notify\DomainEventMessage;
use Bandada\Notification\UseCases\Notify\EventToNotificationMapper;
use Bandada\Notification\UseCases\Notify\HandleDomainEvent;
use Bandada\Notification\UseCases\Notify\NotificationDelivery;
use Bandada\Notification\UseCases\Notify\NotificationSettings;
use Tests\Support\FakeEmailSender;
use Tests\Support\FakePushSender;
use Tests\Support\InMemoryWorld;
use Tests\Support\SequenceIds;

const USER = '0192a3b4-0000-7000-8000-0000000000a1';
const ACTOR = '0192a3b4-0000-7000-8000-0000000000b2';

beforeEach(function () {
    $this->w = new InMemoryWorld;
    $this->email = new FakeEmailSender;
    $this->push = new FakePushSender;
    $this->settings = new NotificationSettings(true, true, 90, 14, 7, 1800, 'http://app.test', []);
    $delivery = new NotificationDelivery($this->w, $this->w, $this->push, $this->email, $this->w, $this->settings);
    $this->handle = new HandleDomainEvent(new EventToNotificationMapper('http://app.test'), $this->w, $this->w, $delivery, $this->settings, $this->w->clock, new SequenceIds);
    $this->event = fn (string $type, array $data, string $id = '0192a3b4-0000-7000-8000-0000000000e1') => new DomainEventMessage($id, $type, '2026-10-14T15:00:00Z', $data);
    $this->confirmed = fn (string $id = '0192a3b4-0000-7000-8000-0000000000e1') => ($this->event)('bandada.events.registration.confirmed.v1', ['userId' => USER, 'eventId' => 'e', 'ticketId' => 't', 'eventTitle' => 'Taller de Docker'], $id);
    $this->w->register(new DeviceToken('ExponentPushToken[abc]', USER, DevicePlatform::Ios, null, null, $this->w->clock->now(), $this->w->clock->now()));
});

it('creates the in-app notification, the inbox record and delivers email and push', function () {
    $this->w->setPrefs(USER, locale: 'es', email: 'lucia@umsa.edu.bo');

    $result = $this->handle->execute(($this->confirmed)());

    $n = array_values($this->w->notifications)[0];
    expect($result->notified)->toBe(1)
        ->and($n->type)->toBe(NotificationType::RegistrationConfirmed)
        ->and($n->params)->toBe(['eventTitle' => 'Taller de Docker'])
        ->and($n->pushStatus())->toBe(DeliveryStatus::Sent)->and($n->emailStatus())->toBe(DeliveryStatus::Sent)
        ->and($this->w->inbox)->toHaveKey('0192a3b4-0000-7000-8000-0000000000e1')
        ->and($this->email->sent)->toHaveCount(1)->and($this->email->sent[0]['to'])->toBe('lucia@umsa.edu.bo')
        ->and($this->push->sent[0]['tokens'])->toBe(['ExponentPushToken[abc]'])
        ->and($this->push->sent[0]['data']['type'])->toBe('REGISTRATION_CONFIRMED')
        ->and($this->w->unreadCount(USER))->toBe(1);
});

it('processes a duplicated message once (inbox) without a second notification, email or push', function () {
    $this->w->setPrefs(USER, email: 'lucia@umsa.edu.bo');

    $first = $this->handle->execute(($this->confirmed)());
    $second = $this->handle->execute(($this->confirmed)());

    expect($first->duplicate)->toBeFalse()->and($second->duplicate)->toBeTrue()
        ->and($this->w->notifications)->toHaveCount(1)
        ->and($this->email->sent)->toHaveCount(1)->and($this->push->sent)->toHaveCount(1)
        ->and($this->w->unreadCount(USER))->toBe(1);
});

it('resumes a delivery left PENDING when the first attempt crashed before sending', function () {
    $this->w->setPrefs(USER, email: 'lucia@umsa.edu.bo');
    // simulate the crash: committed but never delivered
    $broken = new NotificationDelivery($this->w, $this->w, $this->push, $this->email, $this->w, $this->settings);
    $this->email->failures = 99;
    $this->handle->execute(($this->confirmed)());
    expect(array_values($this->w->notifications)[0]->emailStatus())->toBe(DeliveryStatus::Failed);

    $pending = array_values($this->w->notifications)[0];
    $pending->withDelivery(DeliveryStatus::Pending, DeliveryStatus::Pending);
    $this->email->failures = 0;

    $this->handle->execute(($this->confirmed)());

    expect($pending->emailStatus())->toBe(DeliveryStatus::Sent)->and($pending->pushStatus())->toBe(DeliveryStatus::Sent)->and($this->w->notifications)->toHaveCount(1);
});

it('respects preferences: email off, push off', function () {
    $this->w->setPrefs(USER, new ChannelSet(push: false, email: false), email: 'lucia@umsa.edu.bo');

    $this->handle->execute(($this->confirmed)());

    $n = array_values($this->w->notifications)[0];
    expect($this->email->sent)->toBeEmpty()->and($this->push->sent)->toBeEmpty()
        ->and($n->emailStatus())->toBe(DeliveryStatus::None)->and($n->pushStatus())->toBe(DeliveryStatus::None);
});

it('does not store the notification when in-app is off but still emails', function () {
    $this->w->setPrefs(USER, new ChannelSet(inApp: false), email: 'lucia@umsa.edu.bo');

    $this->handle->execute(($this->confirmed)());

    expect($this->w->notifications)->toBeEmpty()->and($this->email->sent)->toHaveCount(1)->and($this->w->unreadCount(USER))->toBe(0)
        ->and($this->w->inbox)->toHaveKey('0192a3b4-0000-7000-8000-0000000000e1');
});

it('creates nothing for a muted type but still records the message', function () {
    $this->w->setPrefs(USER, muted: [NotificationType::NewComment]);

    $this->handle->execute(($this->event)('bandada.social.comment.created.v1', ['postAuthorId' => USER, 'authorId' => ACTOR, 'postId' => 'p']));

    expect($this->w->notifications)->toBeEmpty()->and($this->w->inbox)->toHaveCount(1)->and($this->push->sent)->toBeEmpty();
});

it('marks email as SKIPPED without an address and FAILED after the retries, never throwing', function () {
    $this->w->setPrefs(USER, email: null);
    $this->handle->execute(($this->confirmed)());
    expect(array_values($this->w->notifications)[0]->emailStatus())->toBe(DeliveryStatus::Skipped);

    $this->w->setPrefs(USER, email: 'x@y.z');
    $this->email->failures = 99;
    $this->handle->execute(($this->confirmed)('0192a3b4-0000-7000-8000-0000000000e2'));
    $last = array_values($this->w->notifications)[1];
    expect($last->emailStatus())->toBe(DeliveryStatus::Failed)->and($this->w->inbox)->toHaveCount(2);
});

it('removes device tokens that Expo reports as not registered, and survives push outages', function () {
    $this->push->invalidTokens = ['ExponentPushToken[abc]'];
    $this->handle->execute(($this->confirmed)());
    expect($this->w->devices)->toBeEmpty();

    $this->push->fails = true;
    $this->w->register(new DeviceToken('ExponentPushToken[def]', USER, DevicePlatform::Android, null, null, $this->w->clock->now(), $this->w->clock->now()));
    $this->handle->execute(($this->confirmed)('0192a3b4-0000-7000-8000-0000000000e3'));
    expect(array_values($this->w->notifications)[1]->pushStatus())->toBe(DeliveryStatus::Failed);
});

it('groups reactions: at most one notification per post in the window', function () {
    $react = fn (string $id) => ($this->event)('bandada.social.reaction.set.v1', ['postAuthorId' => USER, 'userId' => ACTOR, 'postId' => 'p1', 'previousType' => null], $id);

    $this->handle->execute($react('0192a3b4-0000-7000-8000-0000000000f1'));
    $second = $this->handle->execute($react('0192a3b4-0000-7000-8000-0000000000f2'));
    $this->w->clock->advance('PT31M');
    $this->handle->execute($react('0192a3b4-0000-7000-8000-0000000000f3'));

    expect($second->notified)->toBe(0)->and($this->w->notifications)->toHaveCount(2)->and($this->w->inbox)->toHaveCount(3);
});

it('renders the welcome in the locale of the event and keeps the profile copy', function () {
    $this->handle->execute(($this->event)('bandada.identity.user.registered.v1', ['userId' => USER, 'email' => 'ana@umsa.edu.bo', 'locale' => 'en', 'displayName' => 'Ana']));

    $n = array_values($this->w->notifications)[0];
    expect($n->locale->value)->toBe('en')->and($this->w->prefs[USER]->locale->value)->toBe('en')->and($this->w->prefs[USER]->email)->toBe('ana@umsa.edu.bo')
        ->and($this->email->sent)->toBeEmpty();   // WELCOME is in-app only (n8n sends the welcome email)
});

it('applies locale changes only when the event is newer than the stored copy', function () {
    $change = fn (string $locale, string $time, string $id) => new DomainEventMessage($id, 'bandada.identity.user.preferences-changed.v1', $time, ['userId' => USER, 'locale' => $locale, 'occurredAt' => $time]);

    $this->handle->execute($change('en', '2026-10-14T16:00:00Z', '0192a3b4-0000-7000-8000-000000000101'));
    $this->handle->execute($change('es', '2026-10-14T15:00:00Z', '0192a3b4-0000-7000-8000-000000000102'));   // older: ignored
    expect($this->w->prefs[USER]->locale->value)->toBe('en');

    $this->handle->execute($change('es', '2026-10-14T17:00:00Z', '0192a3b4-0000-7000-8000-000000000103'));
    expect($this->w->prefs[USER]->locale->value)->toBe('es')->and($this->w->notifications)->toBeEmpty();
});

it('uses the recipient locale, not the emitter one, so old notifications keep their language', function () {
    $this->w->setPrefs(USER, locale: 'en');
    $this->handle->execute(($this->confirmed)());
    $this->w->setPrefs(USER, locale: 'es');
    $this->handle->execute(($this->confirmed)('0192a3b4-0000-7000-8000-0000000000e9'));

    $locales = array_map(fn ($n) => $n->locale->value, array_values($this->w->notifications));
    expect($locales)->toBe(['en', 'es']);
});
