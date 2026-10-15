<?php

use Bandada\Notification\Entities\Channel;
use Bandada\Notification\Entities\ChannelSet;
use Bandada\Notification\Entities\Locale;
use Bandada\Notification\Entities\NotificationPreference;
use Bandada\Notification\Entities\NotificationType;

$pref = fn (ChannelSet $c = new ChannelSet, array $muted = []) => new NotificationPreference('u', $c, $muted, Locale::Es, 'a@b.c', new DateTimeImmutable);

it('uses every default channel of the type when nothing is configured', function () use ($pref) {
    expect($pref()->channelsFor(NotificationType::RegistrationConfirmed))->toBe([Channel::InApp, Channel::Push, Channel::Email])
        ->and($pref()->channelsFor(NotificationType::NewComment))->toBe([Channel::InApp, Channel::Push])
        ->and($pref()->channelsFor(NotificationType::Welcome))->toBe([Channel::InApp]);
});

it('silences a channel switched off by the user', function () use ($pref) {
    expect($pref(new ChannelSet(push: false))->channelsFor(NotificationType::TopUpPaid))->toBe([Channel::InApp, Channel::Email])
        ->and($pref(new ChannelSet(email: false, push: false))->channelsFor(NotificationType::TopUpPaid))->toBe([Channel::InApp])
        ->and($pref(new ChannelSet(inApp: false))->channelsFor(NotificationType::NewComment))->toBe([Channel::Push]);
});

it('mutes a type on every channel but never ALERT or REGISTRATION_FAILED (always in-app)', function () use ($pref) {
    $muted = [NotificationType::NewReaction, NotificationType::Alert, NotificationType::RegistrationFailed];

    expect($pref(muted: $muted)->channelsFor(NotificationType::NewReaction))->toBe([])
        ->and($pref(muted: $muted)->channelsFor(NotificationType::Alert))->toBe([Channel::InApp, Channel::Push, Channel::Email])
        ->and($pref(new ChannelSet(inApp: false, push: false, email: false), $muted)->channelsFor(NotificationType::RegistrationFailed))->toBe([Channel::InApp]);
});
