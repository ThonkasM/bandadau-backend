<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Notify;

use Bandada\Notification\Entities\Channel;
use Bandada\Notification\Entities\Notification;
use Bandada\Notification\Entities\NotificationType;
use Bandada\Notification\UseCases\Ports\Clock;
use Bandada\Notification\UseCases\Ports\CommitRequest;
use Bandada\Notification\UseCases\Ports\IdGenerator;
use Bandada\Notification\UseCases\Ports\NotificationRepository;
use Bandada\Notification\UseCases\Ports\PreferenceRepository;
use DateInterval;

/** Internal entry point (n8n, other services): directed notifications with a per-recipient `dedupeKey`. */
final readonly class SendNotification
{
    public function __construct(
        private NotificationRepository $notifications,
        private PreferenceRepository $preferences,
        private NotificationDelivery $delivery,
        private NotificationSettings $settings,
        private Clock $clock,
        private IdGenerator $ids,
    ) {}

    /**
     * @param  list<string>  $userIds
     * @param  array<string, mixed>  $params
     * @param  array<string, string>  $data
     * @param  list<Channel>|null  $onlyChannels
     * @return array{accepted: int, skipped: int}
     */
    public function execute(array $userIds, NotificationType $type, array $params, array $data, ?string $dedupeKey, ?array $onlyChannels): array
    {
        $accepted = 0;
        $skipped = 0;
        foreach (array_values(array_unique($userIds)) as $userId) {
            $now = $this->clock->now();
            $pref = $this->preferences->get($userId, $now);
            $channels = array_values(array_filter(
                $pref->channelsFor($type),
                static fn (Channel $c): bool => $onlyChannels === null || in_array($c, $onlyChannels, true),
            ));
            if ($channels === []) {
                $skipped++;

                continue;
            }
            [$push, $email] = $this->delivery->initialStatuses($channels, $pref);
            $notification = new Notification(
                $this->ids->next(), $userId, $type, $params, $data, $pref->locale, $now,
                $now->add(new DateInterval('P'.$this->settings->ttlDays.'D')), null, $push, $email,
                in_array(Channel::InApp, $channels, true),
            );
            $inboxKey = $dedupeKey !== null ? 'dedupe:'.$dedupeKey.':'.$userId : 'send:'.$this->ids->next();
            $result = $this->notifications->commit(new CommitRequest(
                $inboxKey, $this->settings->dedupeTtlDays * 86400, $dedupeKey !== null, [$notification], [], [], $now,
            ));
            if ($result->duplicate) {
                $skipped++;

                continue;
            }
            $this->delivery->deliver($notification, $pref);
            $accepted++;
        }

        return ['accepted' => $accepted, 'skipped' => $skipped];
    }
}
