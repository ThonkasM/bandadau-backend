<?php

use Bandada\Notification\Entities\NotificationType;
use Bandada\Notification\UseCases\Notify\DomainEventMessage;
use Bandada\Notification\UseCases\Notify\EventToNotificationMapper;

const BASE = 'http://app.test';
const AUTHOR = '0192a3b4-0000-7000-8000-0000000000a1';
const OTHER = '0192a3b4-0000-7000-8000-0000000000b2';

function mapped(string $type, array $data)
{
    return (new EventToNotificationMapper(BASE))->map(new DomainEventMessage('0192a3b4-0000-7000-8000-0000000000e1', $type, '2026-10-14T15:00:00Z', $data));
}

it('maps the UC-24 table', function (string $type, array $data, NotificationType $expected, string $recipient) {
    $m = mapped($type, $data);

    expect($m->intents)->toHaveCount(1)->and($m->intents[0]->type)->toBe($expected)->and($m->intents[0]->userId)->toBe($recipient);
})->with([
    'confirmed' => ['bandada.events.registration.confirmed.v1', ['userId' => AUTHOR, 'eventId' => 'e', 'ticketId' => 't', 'eventTitle' => 'Taller'], NotificationType::RegistrationConfirmed, AUTHOR],
    'failed' => ['bandada.events.registration.failed.v1', ['userId' => AUTHOR, 'eventId' => 'e', 'reason' => 'EVENT_FULL'], NotificationType::RegistrationFailed, AUTHOR],
    'cancelled' => ['bandada.events.registration.cancelled.v1', ['userId' => AUTHOR, 'eventId' => 'e', 'refundedCredits' => 5], NotificationType::RegistrationCancelled, AUTHOR],
    'event cancelled' => ['bandada.events.event.cancelled.v1', ['organizerId' => AUTHOR, 'eventId' => 'e', 'title' => 'T'], NotificationType::EventCancelled, AUTHOR],
    'comment' => ['bandada.social.comment.created.v1', ['postAuthorId' => AUTHOR, 'authorId' => OTHER, 'postId' => 'p'], NotificationType::NewComment, AUTHOR],
    'reaction' => ['bandada.social.reaction.set.v1', ['postAuthorId' => AUTHOR, 'userId' => OTHER, 'postId' => 'p', 'previousType' => null], NotificationType::NewReaction, AUTHOR],
    'follow' => ['bandada.social.follow.created.v1', ['followeeId' => AUTHOR, 'followerId' => OTHER], NotificationType::NewFollower, AUTHOR],
    'post hidden' => ['bandada.social.post.hidden.v1', ['authorId' => AUTHOR, 'postId' => 'p'], NotificationType::ContentFlagged, AUTHOR],
    'top-up' => ['bandada.wallet.topup.paid.v1', ['userId' => AUTHOR, 'amountCredits' => 50, 'balanceCredits' => 90], NotificationType::TopUpPaid, AUTHOR],
]);

it('does not notify the actor about their own actions', function (string $type, array $data) {
    expect(mapped($type, $data)->intents)->toBeEmpty();
})->with([
    'own comment' => ['bandada.social.comment.created.v1', ['postAuthorId' => AUTHOR, 'authorId' => AUTHOR, 'postId' => 'p']],
    'own reaction' => ['bandada.social.reaction.set.v1', ['postAuthorId' => AUTHOR, 'userId' => AUTHOR, 'postId' => 'p', 'previousType' => null]],
    'changed reaction' => ['bandada.social.reaction.set.v1', ['postAuthorId' => AUTHOR, 'userId' => OTHER, 'postId' => 'p', 'previousType' => 'LIKE']],
    'post created' => ['bandada.social.post.created.v1', ['authorId' => AUTHOR]],
    'unknown event' => ['bandada.media.asset.approved.v1', []],
]);

it('notifies every group admin except the requester, only for pending requests', function () {
    $pending = mapped('bandada.social.group.join-requested.v1', ['groupId' => 'g', 'groupName' => 'Algoritmos', 'userId' => OTHER, 'membershipStatus' => 'PENDING', 'groupAdminIds' => [AUTHOR, OTHER, '0192a3b4-0000-7000-8000-0000000000c3']]);
    $active = mapped('bandada.social.group.join-requested.v1', ['groupId' => 'g', 'groupName' => 'X', 'userId' => OTHER, 'membershipStatus' => 'ACTIVE', 'groupAdminIds' => [AUTHOR]]);

    expect(array_map(fn ($i) => $i->userId, $pending->intents))->toBe([AUTHOR, '0192a3b4-0000-7000-8000-0000000000c3'])
        ->and($pending->intents[0]->params)->toBe(['groupName' => 'Algoritmos'])
        ->and($active->intents)->toBeEmpty();
});

it('groups reactions per post and builds deep links from the configured base', function () {
    $m = mapped('bandada.social.reaction.set.v1', ['postAuthorId' => AUTHOR, 'userId' => OTHER, 'postId' => 'p1', 'previousType' => null]);
    $confirmed = mapped('bandada.events.registration.confirmed.v1', ['userId' => AUTHOR, 'eventId' => 'e', 'ticketId' => 'tk1', 'registrationId' => 'r']);

    expect($m->intents[0]->groupKey)->toBe('reaction:p1:'.AUTHOR)
        ->and($confirmed->intents[0]->data['deepLink'])->toBe('http://app.test/tickets/tk1');
});

it('syncs locale and email from identity events and welcomes new users', function () {
    $registered = mapped('bandada.identity.user.registered.v1', ['userId' => AUTHOR, 'email' => 'a@umsa.edu.bo', 'locale' => 'en', 'displayName' => 'Ana']);
    $changed = mapped('bandada.identity.user.preferences-changed.v1', ['userId' => AUTHOR, 'locale' => 'xx', 'theme' => 'DARK']);

    expect($registered->profile->locale->value)->toBe('en')->and($registered->profile->email)->toBe('a@umsa.edu.bo')
        ->and($registered->intents[0]->type)->toBe(NotificationType::Welcome)
        ->and($changed->intents)->toBeEmpty()->and($changed->profile->locale->value)->toBe('es');
});

it('notifies alert recipients only when the event names them', function () {
    expect(mapped('bandada.insights.alert.raised.v1', ['message' => 'DLQ', 'severity' => 'WARNING'])->intents)->toBeEmpty()
        ->and(mapped('bandada.insights.alert.raised.v1', ['message' => 'DLQ', 'recipientUserIds' => [AUTHOR]])->intents)->toHaveCount(1);
});

it('names the actor in comment, reaction and follow texts only when the event carries actorDisplayName', function () {
    $comment = ['postAuthorId' => AUTHOR, 'authorId' => OTHER, 'postId' => 'p'];
    $reaction = ['postAuthorId' => AUTHOR, 'userId' => OTHER, 'postId' => 'p', 'previousType' => null];
    $follow = ['followeeId' => AUTHOR, 'followerId' => OTHER];
    foreach ([['bandada.social.comment.created.v1', $comment], ['bandada.social.reaction.set.v1', $reaction], ['bandada.social.follow.created.v1', $follow]] as [$type, $data]) {
        expect(mapped($type, $data + ['actorDisplayName' => ' Lucía Vargas '])->intents[0]->params)->toMatchArray(['actorName' => 'Lucía Vargas', 'hasActor' => 'yes'])
            ->and(mapped($type, $data)->intents[0]->params)->not->toHaveKey('hasActor');
    }
});
