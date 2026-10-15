<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Notify;

use Bandada\Notification\Entities\Channel;
use Bandada\Notification\Entities\Notification;
use Bandada\Notification\Entities\NotificationPreference;
use Bandada\Notification\Entities\ProfileSync;
use Bandada\Notification\UseCases\Ports\Clock;
use Bandada\Notification\UseCases\Ports\CommitRequest;
use Bandada\Notification\UseCases\Ports\IdGenerator;
use Bandada\Notification\UseCases\Ports\NotificationRepository;
use Bandada\Notification\UseCases\Ports\PreferenceRepository;
use DateInterval;

/**
 * UC-24: event -> inbox record + notifications (one transaction), then delivery on the other channels.
 * A duplicate message (same CloudEvent id) creates nothing; it only resumes deliveries left PENDING.
 */
final readonly class HandleDomainEvent
{
    public function __construct(
        private EventToNotificationMapper $mapper,
        private NotificationRepository $notifications,
        private PreferenceRepository $preferences,
        private NotificationDelivery $delivery,
        private NotificationSettings $settings,
        private Clock $clock,
        private IdGenerator $ids,
    ) {}

    public function execute(DomainEventMessage $message): HandleResult
    {
        $now = $this->clock->now();
        $mapped = $this->mapper->map($message);

        /** @var array<string, NotificationPreference> $prefs */
        $prefs = [];
        $prefOf = function (string $userId) use (&$prefs, $now): NotificationPreference {
            return $prefs[$userId] ??= $this->preferences->get($userId, $now);
        };

        // Local copy of locale/email: only a newer event may overwrite it (events can arrive out of order).
        $profiles = [];
        if ($mapped->profile !== null) {
            $current = $prefOf($mapped->profile->userId);
            if ($current->localeUpdatedAt === null || $current->localeUpdatedAt < $mapped->profile->eventTime) {
                $profiles[] = $mapped->profile;
                $prefs[$mapped->profile->userId] = $this->withProfile($current, $mapped->profile);
            }
        }

        /** @var list<array{notification: Notification, pref: NotificationPreference, group: ?string}> $drafts */
        $drafts = [];
        foreach ($mapped->intents as $intent) {
            $pref = $prefOf($intent->userId);
            $channels = $pref->channelsFor($intent->type);
            if ($channels === []) {
                continue;
            }
            [$push, $email] = $this->delivery->initialStatuses($channels, $pref);
            $drafts[] = [
                'notification' => new Notification(
                    $this->ids->next(), $intent->userId, $intent->type, $intent->params, $intent->data, $pref->locale,
                    $now, $now->add(new DateInterval('P'.$this->settings->ttlDays.'D')), null, $push, $email,
                    in_array(Channel::InApp, $channels, true),
                ),
                'pref' => $pref,
                'group' => $intent->groupKey,
            ];
        }

        $inboxTtl = $this->settings->inboxTtlDays * 86400;
        for ($pass = 0; $pass < 3; $pass++) {
            $claims = [];
            foreach ($drafts as $draft) {
                if ($draft['group'] !== null) {
                    $claims[$draft['group']] = $this->settings->reactionGroupSeconds;
                }
            }
            $result = $this->notifications->commit(new CommitRequest(
                $message->id, $inboxTtl, false,
                array_map(static fn (array $d): Notification => $d['notification'], $drafts),
                $profiles, $claims, $now,
            ));
            if ($result->duplicate) {
                return $this->resume($message->id);
            }
            if ($result->suppressedGroups === []) {
                foreach ($drafts as $draft) {
                    $this->delivery->deliver($draft['notification'], $draft['pref']);
                }

                return new HandleResult(false, count($drafts));
            }
            $drafts = array_values(array_filter($drafts, static fn (array $d): bool => ! in_array($d['group'], $result->suppressedGroups, true)));
        }

        return new HandleResult(false, 0);
    }

    private function resume(string $inboxKey): HandleResult
    {
        $now = $this->clock->now();
        $resumed = 0;
        foreach ($this->notifications->inboxNotifications($inboxKey) as $notification) {
            $pref = $this->preferences->get($notification->userId, $now);
            $this->delivery->deliver($notification, $pref);
            $resumed++;
        }

        return new HandleResult(true, $resumed);
    }

    private function withProfile(NotificationPreference $pref, ProfileSync $profile): NotificationPreference
    {
        return new NotificationPreference(
            $pref->userId, $pref->channels, $pref->mutedTypes, $profile->locale, $profile->email ?? $pref->email,
            $pref->updatedAt, $profile->eventTime, $pref->unreadCount,
        );
    }
}
