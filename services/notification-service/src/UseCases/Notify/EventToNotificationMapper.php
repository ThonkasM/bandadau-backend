<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Notify;

use Bandada\Notification\Entities\Locale;
use Bandada\Notification\Entities\NotificationType;
use Bandada\Notification\Entities\ProfileSync;
use DateTimeImmutable;
use Throwable;

/** UC-24 mapping table: domain event -> who is notified about what. Unknown events notify nobody. */
final readonly class EventToNotificationMapper
{
    private const int MAX_RECIPIENTS = 40;

    public function __construct(private string $deepLinkBase) {}

    public function map(DomainEventMessage $m): MappedEvent
    {
        $d = $m->data;

        return match ($m->type) {
            'bandada.events.registration.confirmed.v1' => $this->one($d['userId'] ?? null, NotificationType::RegistrationConfirmed,
                $this->pick($d, ['eventTitle', 'eventStartsAt']),
                $this->links($d, ['eventId', 'registrationId', 'ticketId'], isset($d['ticketId']) ? '/tickets/'.$this->str($d['ticketId']) : '/events/'.$this->str($d['eventId'] ?? ''))),
            'bandada.events.registration.failed.v1' => $this->one($d['userId'] ?? null, NotificationType::RegistrationFailed,
                $this->pick($d, ['eventTitle', 'eventStartsAt', 'reason']),
                $this->links($d, ['eventId', 'registrationId'], '/events/'.$this->str($d['eventId'] ?? ''))),
            'bandada.events.registration.cancelled.v1' => $this->one($d['userId'] ?? null, NotificationType::RegistrationCancelled,
                $this->pick($d, ['eventTitle', 'eventStartsAt', 'refundedCredits']),
                $this->links($d, ['eventId', 'registrationId'], '/events/'.$this->str($d['eventId'] ?? ''))),
            'bandada.events.event.cancelled.v1' => $this->one($d['organizerId'] ?? null, NotificationType::EventCancelled,
                $this->pick($d, ['eventTitle' => 'title', 'startsAt', 'confirmedRegistrations']),
                $this->links($d, ['eventId'], '/events/'.$this->str($d['eventId'] ?? ''))),
            'bandada.social.comment.created.v1' => $this->comment($d),
            'bandada.social.reaction.set.v1' => $this->reaction($d),
            'bandada.social.follow.created.v1' => $this->one($d['followeeId'] ?? null, NotificationType::NewFollower, [],
                $this->links($d, ['followerId'], '/profiles/'.$this->str($d['followerId'] ?? ''))),
            'bandada.social.group.join-requested.v1' => $this->groupRequest($d),
            'bandada.social.post.hidden.v1', 'bandada.social.post.removed.v1' => $this->one($d['authorId'] ?? null, NotificationType::ContentFlagged, [],
                $this->links($d, ['postId'], '/posts/'.$this->str($d['postId'] ?? ''))),
            'bandada.social.comment.hidden.v1' => $this->one($d['authorId'] ?? null, NotificationType::ContentFlagged, [],
                $this->links($d, ['postId', 'commentId'], '/posts/'.$this->str($d['postId'] ?? ''))),
            'bandada.wallet.topup.paid.v1' => $this->one($d['userId'] ?? null, NotificationType::TopUpPaid,
                $this->pick($d, ['amountCredits', 'balanceCredits', 'package']), ['deepLink' => $this->deepLinkBase.'/wallet']),
            'bandada.insights.alert.raised.v1' => $this->alert($d),
            'bandada.identity.user.registered.v1' => $this->registered($m),
            'bandada.identity.user.preferences-changed.v1' => $this->preferencesChanged($m),
            default => MappedEvent::nothing(),
        };
    }

    /** @param array<string, mixed> $d */
    private function comment(array $d): MappedEvent
    {
        $author = $d['postAuthorId'] ?? null;
        if (($d['authorId'] ?? null) === $author) {
            return MappedEvent::nothing();
        }

        return $this->one($author, NotificationType::NewComment, [], $this->links($d, ['postId', 'commentId'], '/posts/'.$this->str($d['postId'] ?? '')));
    }

    /** @param array<string, mixed> $d */
    private function reaction(array $d): MappedEvent
    {
        $author = $d['postAuthorId'] ?? null;
        if (($d['userId'] ?? null) === $author || ($d['previousType'] ?? null) !== null || ! is_string($author)) {
            return MappedEvent::nothing();
        }

        return new MappedEvent([new Intent(
            $author,
            NotificationType::NewReaction,
            [],
            $this->links($d, ['postId'], '/posts/'.$this->str($d['postId'] ?? '')),
            'reaction:'.$this->str($d['postId'] ?? '').':'.$author,
        )]);
    }

    /** @param array<string, mixed> $d */
    private function groupRequest(array $d): MappedEvent
    {
        if (($d['membershipStatus'] ?? 'PENDING') !== 'PENDING') {
            return MappedEvent::nothing();
        }
        $admins = is_array($d['groupAdminIds'] ?? null) ? array_slice(array_values(array_unique(array_filter($d['groupAdminIds'], 'is_string'))), 0, self::MAX_RECIPIENTS) : [];
        $intents = [];
        foreach ($admins as $admin) {
            if ($admin !== ($d['userId'] ?? null)) {
                $intents[] = new Intent($admin, NotificationType::GroupRequest, $this->pick($d, ['groupName']),
                    $this->links($d, ['groupId'], '/groups/'.$this->str($d['groupId'] ?? '')));
            }
        }

        return new MappedEvent($intents);
    }

    /** @param array<string, mixed> $d */
    private function alert(array $d): MappedEvent
    {
        $recipients = is_array($d['recipientUserIds'] ?? null) ? array_slice(array_values(array_filter($d['recipientUserIds'], 'is_string')), 0, self::MAX_RECIPIENTS) : [];
        $intents = array_map(fn (string $id): Intent => new Intent($id, NotificationType::Alert, $this->pick($d, ['message', 'severity', 'kind']), []), $recipients);

        return new MappedEvent($intents);
    }

    private function registered(DomainEventMessage $m): MappedEvent
    {
        $d = $m->data;
        $userId = $d['userId'] ?? null;
        if (! is_string($userId)) {
            return MappedEvent::nothing();
        }

        return new MappedEvent(
            [new Intent($userId, NotificationType::Welcome, $this->pick($d, ['displayName']), ['deepLink' => $this->deepLinkBase])],
            new ProfileSync($userId, Locale::orDefault(is_string($d['locale'] ?? null) ? $d['locale'] : null), is_string($d['email'] ?? null) ? $d['email'] : null, $this->time($m)),
        );
    }

    private function preferencesChanged(DomainEventMessage $m): MappedEvent
    {
        $userId = $m->data['userId'] ?? null;
        if (! is_string($userId)) {
            return MappedEvent::nothing();
        }

        return new MappedEvent([], new ProfileSync($userId, Locale::orDefault(is_string($m->data['locale'] ?? null) ? $m->data['locale'] : null), null, $this->time($m)));
    }

    private function time(DomainEventMessage $m): DateTimeImmutable
    {
        $candidate = is_string($m->data['occurredAt'] ?? null) ? $m->data['occurredAt'] : $m->time;
        try {
            return new DateTimeImmutable($candidate ?? 'now');
        } catch (Throwable) {
            return new DateTimeImmutable;
        }
    }

    /**
     * @param  array<string, mixed>  $params
     * @param  array<string, string>  $data
     */
    private function one(mixed $userId, NotificationType $type, array $params, array $data): MappedEvent
    {
        return is_string($userId) && $userId !== '' ? new MappedEvent([new Intent($userId, $type, $params, $data)]) : MappedEvent::nothing();
    }

    /**
     * @param  array<string, mixed>  $d
     * @param  list<string>|array<string, string>  $keys  list of keys, or targetKey => sourceKey
     * @return array<string, mixed>
     */
    private function pick(array $d, array $keys): array
    {
        $out = [];
        foreach ($keys as $target => $source) {
            $targetKey = is_int($target) ? $source : $target;
            if (isset($d[$source]) && (is_scalar($d[$source]))) {
                $out[$targetKey] = $d[$source];
            }
        }

        return $out;
    }

    /**
     * @param  array<string, mixed>  $d
     * @param  list<string>  $ids
     * @return array<string, string>
     */
    private function links(array $d, array $ids, string $path): array
    {
        $out = ['deepLink' => $this->deepLinkBase.$path];
        foreach ($ids as $id) {
            if (isset($d[$id]) && is_string($d[$id])) {
                $out[$id] = $d[$id];
            }
        }

        return $out;
    }

    private function str(mixed $v): string
    {
        return is_string($v) ? $v : '';
    }
}
