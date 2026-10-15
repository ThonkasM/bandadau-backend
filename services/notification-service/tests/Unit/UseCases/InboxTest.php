<?php

use Bandada\Notification\Entities\ChannelSet;
use Bandada\Notification\Entities\DevicePlatform;
use Bandada\Notification\Entities\Exception\InvalidDeviceTokenException;
use Bandada\Notification\Entities\Exception\NotificationNotFoundException;
use Bandada\Notification\Entities\Exception\NotMutableTypeException;
use Bandada\Notification\Entities\Locale;
use Bandada\Notification\Entities\Notification;
use Bandada\Notification\Entities\NotificationType;
use Bandada\Notification\UseCases\Devices\RegisterDevice;
use Bandada\Notification\UseCases\Devices\UpdatePreferences;
use Bandada\Notification\UseCases\Inbox\ListNotifications;
use Bandada\Notification\UseCases\Inbox\MarkAllAsRead;
use Bandada\Notification\UseCases\Inbox\MarkAsRead;
use Bandada\Notification\UseCases\Ports\CommitRequest;
use Tests\Support\InMemoryWorld;

function seed(InMemoryWorld $w, string $user, string $id)
{
    $now = $w->clock->now();
    $n = new Notification($id, $user, NotificationType::NewComment, [], [], Locale::Es, $now, $now->modify('+90 days'));
    $w->commit(new CommitRequest('m'.$id, 100, false, [$n], [], [], $now));

    return $n;
}

beforeEach(function () {
    $this->w = new InMemoryWorld;
    foreach (range(1, 5) as $i) {
        seed($this->w, 'u1', sprintf('0192a3b4-0000-7000-8000-%012d', $i));
    }
    seed($this->w, 'u2', '0192a3b4-0000-7000-8000-0000000000ff');
});

it('lists newest first with a cursor and the unread count', function () {
    $list = new ListNotifications($this->w, $this->w);

    $p1 = $list->execute('u1', 2, null, false);
    $p2 = $list->execute('u1', 2, $p1['nextAfterId'], false);
    $p3 = $list->execute('u1', 2, $p2['nextAfterId'], false);

    expect($p1['items'][0]->notification->id)->toEndWith('000000000005')
        ->and($p1['unreadCount'])->toBe(5)
        ->and(count($p2['items']))->toBe(2)->and(count($p3['items']))->toBe(1)->and($p3['nextAfterId'])->toBeNull();
});

it('marks as read idempotently, keeping the first readAt, and hides other users notifications', function () {
    $mark = new MarkAsRead($this->w, $this->w, $this->w->clock);
    $id = '0192a3b4-0000-7000-8000-000000000001';

    $first = $mark->execute('u1', $id);
    $this->w->clock->advance('PT5M');
    $again = $mark->execute('u1', $id);

    expect($again->notification->readAt())->toEqual($first->notification->readAt())->and($this->w->unreadCount('u1'))->toBe(4);
    expect(fn () => $mark->execute('u1', '0192a3b4-0000-7000-8000-0000000000ff'))->toThrow(NotificationNotFoundException::class);
});

it('marks all as read', function () {
    $result = (new MarkAllAsRead($this->w, $this->w->clock))->execute('u1');

    expect($result['updatedCount'])->toBe(5)->and($this->w->unreadCount('u1'))->toBe(0)->and($this->w->unreadCount('u2'))->toBe(1);
});

it('refuses to mute ALERT and REGISTRATION_FAILED', function () {
    (new UpdatePreferences($this->w, $this->w->clock))->execute('u1', new ChannelSet, [NotificationType::Alert]);
})->throws(NotMutableTypeException::class);

it('validates device token length', function () {
    (new RegisterDevice($this->w, $this->w->clock))->execute('u1', 'short', DevicePlatform::Ios, null, null);
})->throws(InvalidDeviceTokenException::class);
