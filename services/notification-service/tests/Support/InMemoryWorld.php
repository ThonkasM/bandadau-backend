<?php

declare(strict_types=1);

namespace Tests\Support;

use Bandada\Notification\Entities\ChannelSet;
use Bandada\Notification\Entities\DeviceToken;
use Bandada\Notification\Entities\Locale;
use Bandada\Notification\Entities\Notification;
use Bandada\Notification\Entities\NotificationPreference;
use Bandada\Notification\UseCases\Ports\CommitRequest;
use Bandada\Notification\UseCases\Ports\CommitResult;
use Bandada\Notification\UseCases\Ports\DeviceRepository;
use Bandada\Notification\UseCases\Ports\NotificationRepository;
use Bandada\Notification\UseCases\Ports\PreferenceRepository;
use Bandada\Notification\UseCases\Ports\RenderedMessage;
use Bandada\Notification\UseCases\Ports\TemplateRenderer;
use Bandada\Notification\Entities\NotificationType;
use DateTimeImmutable;

/** In-memory doubles of every port, sharing one state (DynamoDB semantics of commit(): inbox + group claims). */
final class InMemoryWorld implements DeviceRepository, NotificationRepository, PreferenceRepository, TemplateRenderer
{
    /** @var array<string, array{refs: list<string>, expires: int}> */
    public array $inbox = [];

    /** @var array<string, int> group key => expiry epoch */
    public array $groups = [];

    /** @var array<string, Notification> keyed by userId|id */
    public array $notifications = [];

    /** @var array<string, NotificationPreference> */
    public array $prefs = [];

    /** @var array<string, int> */
    public array $unread = [];

    /** @var array<string, DeviceToken> keyed by token */
    public array $devices = [];

    public function __construct(public readonly FixedClock $clock = new FixedClock) {}

    // NotificationRepository
    public function commit(CommitRequest $r): CommitResult
    {
        $now = $r->now->getTimestamp();
        $existing = $this->inbox[$r->inboxKey] ?? null;
        if ($existing !== null && (! $r->inboxExpires || $existing['expires'] >= $now)) {
            return new CommitResult(true);
        }
        $suppressed = [];
        foreach ($r->groupClaims as $key => $seconds) {
            if (isset($this->groups[$key]) && $this->groups[$key] >= $now) {
                $suppressed[] = $key;
            }
        }
        if ($suppressed !== []) {
            return new CommitResult(false, $suppressed);
        }
        foreach ($r->groupClaims as $key => $seconds) {
            $this->groups[$key] = $now + $seconds;
        }
        $stored = array_values(array_filter($r->notifications, static fn (Notification $n): bool => $n->stored));
        $this->inbox[$r->inboxKey] = ['refs' => array_map(static fn (Notification $n): string => $n->userId.'|'.$n->id, $stored), 'expires' => $now + $r->inboxTtlSeconds];
        foreach ($stored as $n) {
            $this->notifications[$n->userId.'|'.$n->id] = $n;
            $this->unread[$n->userId] = ($this->unread[$n->userId] ?? 0) + 1;
        }
        foreach ($r->profiles as $p) {
            $current = $this->prefs[$p->userId] ?? NotificationPreference::defaults($p->userId, $r->now);
            $this->prefs[$p->userId] = new NotificationPreference(
                $p->userId, $current->channels, $current->mutedTypes, $p->locale, $p->email ?? $current->email,
                $current->updatedAt, $p->eventTime, $current->unreadCount,
            );
        }

        return new CommitResult(false);
    }

    public function inboxNotifications(string $inboxKey): array
    {
        return array_values(array_filter(array_map(fn (string $ref): ?Notification => $this->notifications[$ref] ?? null, $this->inbox[$inboxKey]['refs'] ?? [])));
    }

    public function find(string $userId, string $id): ?Notification
    {
        return $this->notifications[$userId.'|'.$id] ?? null;
    }

    public function page(string $userId, int $limit, ?string $afterId, bool $unreadOnly): array
    {
        $rows = array_values(array_filter($this->notifications, static fn (Notification $n): bool => $n->userId === $userId && (! $unreadOnly || ! $n->isRead())));
        usort($rows, static fn (Notification $a, Notification $b): int => strcmp($b->id, $a->id));
        if ($afterId !== null) {
            $rows = array_values(array_filter($rows, static fn (Notification $n): bool => strcmp($n->id, $afterId) < 0));
        }

        return array_slice($rows, 0, $limit);
    }

    public function markRead(string $userId, string $id, DateTimeImmutable $now): ?Notification
    {
        $n = $this->find($userId, $id);
        if ($n !== null && ! $n->isRead()) {
            $n->markRead($now);
            $this->unread[$userId] = max(0, ($this->unread[$userId] ?? 0) - 1);
        }

        return $n;
    }

    public function markAllRead(string $userId, DateTimeImmutable $now): int
    {
        $count = 0;
        foreach ($this->page($userId, 1000, null, true) as $n) {
            $this->markRead($userId, $n->id, $now);
            $count++;
        }

        return $count;
    }

    public function updateDelivery(Notification $notification): void {}

    public function unreadCount(string $userId): int
    {
        return $this->unread[$userId] ?? 0;
    }

    // PreferenceRepository
    public function get(string $userId, DateTimeImmutable $now): NotificationPreference
    {
        return $this->prefs[$userId] ?? NotificationPreference::defaults($userId, $now);
    }

    public function save(string $userId, ChannelSet $channels, array $mutedTypes, DateTimeImmutable $now): NotificationPreference
    {
        $c = $this->get($userId, $now);

        return $this->prefs[$userId] = new NotificationPreference($userId, $channels, $mutedTypes, $c->locale, $c->email, $now, $c->localeUpdatedAt);
    }

    public function setPrefs(string $userId, ?ChannelSet $channels = null, array $muted = [], string $locale = 'es', ?string $email = 'user@example.test'): void
    {
        $this->prefs[$userId] = new NotificationPreference($userId, $channels ?? new ChannelSet, $muted, Locale::from($locale), $email, $this->clock->now());
    }

    // DeviceRepository
    public function register(DeviceToken $device): DeviceToken
    {
        return $this->devices[$device->token] = $device;
    }

    public function remove(string $userId, string $token): void
    {
        if (($this->devices[$token]->userId ?? null) === $userId) {
            unset($this->devices[$token]);
        }
    }

    public function forUser(string $userId): array
    {
        return array_values(array_filter($this->devices, static fn (DeviceToken $d): bool => $d->userId === $userId));
    }

    // TemplateRenderer
    public function render(NotificationType $type, array $params, Locale $locale): RenderedMessage
    {
        return new RenderedMessage("[{$locale->value}] {$type->value}", json_encode($params, JSON_UNESCAPED_UNICODE) ?: '');
    }

}
