<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Gateways\Dynamo;

use Aws\DynamoDb\DynamoDbClient;
use Aws\DynamoDb\Exception\DynamoDbException;
use Aws\DynamoDb\Marshaler;
use Bandada\Notification\Entities\DeliveryStatus;
use Bandada\Notification\Entities\Locale;
use Bandada\Notification\Entities\Notification;
use Bandada\Notification\Entities\NotificationType;
use Bandada\Notification\Entities\ProfileSync;
use Bandada\Notification\InterfaceAdapters\Shared\Support\Timestamps;
use Bandada\Notification\UseCases\Ports\CommitRequest;
use Bandada\Notification\UseCases\Ports\CommitResult;
use Bandada\Notification\UseCases\Ports\NotificationRepository;
use DateTimeImmutable;
use DateTimeZone;
use RuntimeException;

/**
 * Single-table design (DynamoDB `bandada-notifications`):
 *   USER#<u> / NOTIF#<uuidv7>   notification (TTL expiresAt)
 *   USER#<u> / PREF             preferences, locale/email copy, unreadCount
 *   INBOX#<messageId> / META    processed message (TTL 14 days) + refs of what it created
 */
final readonly class DynamoNotificationRepository implements NotificationRepository
{
    public function __construct(private DynamoDbClient $client, private Marshaler $marshaler, private string $table) {}

    public function commit(CommitRequest $r): CommitResult
    {
        $now = $r->now;
        $epoch = $now->getTimestamp();
        $stored = array_values(array_filter($r->notifications, static fn (Notification $n): bool => $n->stored));

        $inboxItem = [
            'pk' => 'INBOX#'.$r->inboxKey, 'sk' => 'META',
            'processedAt' => Timestamps::toDb($now), 'expiresAt' => $epoch + $r->inboxTtlSeconds,
            'refs' => array_map(static fn (Notification $n): string => $n->userId.'|'.$n->id, $stored),
        ];
        $items = [['Put' => array_filter([
            'TableName' => $this->table,
            'Item' => $this->marshaler->marshalItem($inboxItem),
            'ConditionExpression' => $r->inboxExpires ? 'attribute_not_exists(pk) OR expiresAt < :now' : 'attribute_not_exists(pk)',
            'ExpressionAttributeValues' => $r->inboxExpires ? [':now' => ['N' => (string) $epoch]] : null,
        ])]];

        $groupIndexes = [];
        foreach ($r->groupClaims as $key => $seconds) {
            $groupIndexes[count($items)] = $key;
            $items[] = ['Put' => [
                'TableName' => $this->table,
                'Item' => $this->marshaler->marshalItem(['pk' => 'INBOX#group:'.$key, 'sk' => 'META', 'expiresAt' => $epoch + $seconds]),
                'ConditionExpression' => 'attribute_not_exists(pk) OR expiresAt < :now',
                'ExpressionAttributeValues' => [':now' => ['N' => (string) $epoch]],
            ]];
        }

        $unread = [];
        foreach ($stored as $n) {
            $items[] = ['Put' => ['TableName' => $this->table, 'Item' => $this->marshaler->marshalItem($this->toItem($n))]];
            $unread[$n->userId] = ($unread[$n->userId] ?? 0) + 1;
        }

        $profiles = [];
        foreach ($r->profiles as $p) {
            $profiles[$p->userId] = $p;
        }
        foreach (array_unique([...array_keys($unread), ...array_keys($profiles)]) as $userId) {
            $items[] = ['Update' => $this->prefUpdate((string) $userId, $unread[$userId] ?? 0, $profiles[$userId] ?? null, $now)];
        }

        if (count($items) > 100) {
            throw new RuntimeException('Too many items for a single transaction');
        }

        try {
            $this->client->transactWriteItems(['TransactItems' => $items]);

            return new CommitResult(false);
        } catch (DynamoDbException $e) {
            if (DynamoSupport::code($e) !== 'TransactionCanceledException') {
                throw DynamoSupport::unavailable($e);
            }
            $codes = DynamoSupport::cancellationCodes($e);
            if (($codes[0] ?? '') === 'ConditionalCheckFailed') {
                return new CommitResult(true);
            }
            $suppressed = [];
            foreach ($groupIndexes as $index => $key) {
                if (($codes[$index] ?? '') === 'ConditionalCheckFailed') {
                    $suppressed[] = $key;
                }
            }
            if ($suppressed === []) {
                throw new RuntimeException('Notification transaction cancelled: '.implode(',', $codes), 0, $e);
            }

            return new CommitResult(false, $suppressed);
        }
    }

    public function inboxNotifications(string $inboxKey): array
    {
        $inbox = $this->getItem('INBOX#'.$inboxKey, 'META');
        $out = [];
        foreach (is_array($inbox['refs'] ?? null) ? $inbox['refs'] : [] as $ref) {
            [$userId, $id] = array_pad(explode('|', (string) $ref, 2), 2, '');
            $n = $this->find($userId, $id);
            if ($n !== null) {
                $out[] = $n;
            }
        }

        return $out;
    }

    public function find(string $userId, string $id): ?Notification
    {
        $item = $this->getItem('USER#'.$userId, 'NOTIF#'.$id);

        return $item === null ? null : $this->hydrate($item);
    }

    public function page(string $userId, int $limit, ?string $afterId, bool $unreadOnly): array
    {
        $out = [];
        $startKey = $afterId === null ? null : $this->marshaler->marshalItem(['pk' => 'USER#'.$userId, 'sk' => 'NOTIF#'.$afterId]);
        do {
            $query = [
                'TableName' => $this->table,
                'KeyConditionExpression' => 'pk = :pk AND begins_with(sk, :n)',
                'ExpressionAttributeValues' => [':pk' => ['S' => 'USER#'.$userId], ':n' => ['S' => 'NOTIF#']],
                'ScanIndexForward' => false,
                'Limit' => $unreadOnly ? 100 : $limit,
            ];
            if ($unreadOnly) {
                $query['FilterExpression'] = 'readAt = :null';
                $query['ExpressionAttributeValues'][':null'] = ['NULL' => true];
            }
            if ($startKey !== null) {
                $query['ExclusiveStartKey'] = $startKey;
            }
            try {
                $result = $this->client->query($query);
            } catch (DynamoDbException $e) {
                throw DynamoSupport::unavailable($e);
            }
            foreach ($result['Items'] ?? [] as $raw) {
                $out[] = $this->hydrate(DynamoSupport::plain($this->marshaler, $raw));
                if (count($out) >= $limit) {
                    return $out;
                }
            }
            $startKey = $result['LastEvaluatedKey'] ?? null;
        } while ($startKey !== null);

        return $out;
    }

    public function markRead(string $userId, string $id, DateTimeImmutable $now): ?Notification
    {
        return $this->markReadInternal($userId, $id, $now)[0];
    }

    public function markAllRead(string $userId, DateTimeImmutable $now): int
    {
        $updated = 0;
        $after = null;
        do {
            $page = $this->page($userId, 100, $after, true);
            foreach ($page as $n) {
                if ($this->markReadInternal($userId, $n->id, $now)[1]) {
                    $updated++;
                }
            }
            $after = $page === [] ? null : $page[array_key_last($page)]->id;
        } while (count($page) === 100);

        return $updated;
    }

    public function updateDelivery(Notification $notification): void
    {
        try {
            $this->client->updateItem([
                'TableName' => $this->table,
                'Key' => $this->marshaler->marshalItem(['pk' => 'USER#'.$notification->userId, 'sk' => 'NOTIF#'.$notification->id]),
                'UpdateExpression' => 'SET pushStatus = :p, emailStatus = :e',
                'ConditionExpression' => 'attribute_exists(pk)',
                'ExpressionAttributeValues' => $this->marshaler->marshalItem([':p' => $notification->pushStatus()->value, ':e' => $notification->emailStatus()->value]),
            ]);
        } catch (DynamoDbException $e) {
            if (DynamoSupport::code($e) !== 'ConditionalCheckFailedException') {
                throw DynamoSupport::unavailable($e);
            }
        }
    }

    public function unreadCount(string $userId): int
    {
        $item = $this->getItem('USER#'.$userId, 'PREF');

        return max(0, (int) ($item['unreadCount'] ?? 0));
    }

    /** @return array{0: ?Notification, 1: bool} notification (null if missing) and whether this call flipped it to read */
    private function markReadInternal(string $userId, string $id, DateTimeImmutable $now): array
    {
        $n = $this->find($userId, $id);
        if ($n === null) {
            return [null, false];
        }
        if ($n->isRead()) {
            return [$n, false];
        }
        $iso = Timestamps::toDb($now);
        try {
            $this->client->transactWriteItems(['TransactItems' => [
                ['Update' => [
                    'TableName' => $this->table,
                    'Key' => $this->marshaler->marshalItem(['pk' => 'USER#'.$userId, 'sk' => 'NOTIF#'.$id]),
                    'UpdateExpression' => 'SET readAt = :now',
                    'ConditionExpression' => 'attribute_exists(pk) AND readAt = :null',
                    'ExpressionAttributeValues' => [':now' => ['S' => $iso], ':null' => ['NULL' => true]],
                ]],
                ['Update' => [
                    'TableName' => $this->table,
                    'Key' => $this->marshaler->marshalItem(['pk' => 'USER#'.$userId, 'sk' => 'PREF']),
                    'UpdateExpression' => 'ADD unreadCount :m1',
                    'ExpressionAttributeValues' => [':m1' => ['N' => '-1']],
                ]],
            ]]);
            $n->markRead($now);

            return [$n, true];
        } catch (DynamoDbException $e) {
            if (DynamoSupport::code($e) !== 'TransactionCanceledException') {
                throw DynamoSupport::unavailable($e);
            }

            // Somebody else marked it first: keep their readAt.
            return [$this->find($userId, $id), false];
        }
    }

    /** @return array<string, mixed>|null */
    private function getItem(string $pk, string $sk): ?array
    {
        try {
            $result = $this->client->getItem([
                'TableName' => $this->table,
                'Key' => $this->marshaler->marshalItem(['pk' => $pk, 'sk' => $sk]),
                'ConsistentRead' => true,
            ]);
        } catch (DynamoDbException $e) {
            throw DynamoSupport::unavailable($e);
        }
        $raw = $result['Item'] ?? null;
        if (! is_array($raw)) {
            return null;
        }
        return DynamoSupport::plain($this->marshaler, $raw);
    }

    /** @return array<string, mixed> */
    private function toItem(Notification $n): array
    {
        return [
            'pk' => 'USER#'.$n->userId, 'sk' => 'NOTIF#'.$n->id, 'id' => $n->id, 'userId' => $n->userId,
            'type' => $n->type->value, 'params' => $n->params, 'data' => (object) $n->data, 'locale' => $n->locale->value,
            'readAt' => null, 'createdAt' => Timestamps::toDb($n->createdAt), 'expiresAt' => $n->expiresAt->getTimestamp(),
            'pushStatus' => $n->pushStatus()->value, 'emailStatus' => $n->emailStatus()->value,
        ];
    }

    /** @param array<string, mixed> $i */
    private function hydrate(array $i): Notification
    {
        $data = [];
        foreach (is_array($i['data'] ?? null) ? $i['data'] : [] as $k => $v) {
            $data[(string) $k] = (string) $v;
        }

        return new Notification(
            (string) $i['id'], (string) $i['userId'], NotificationType::from((string) $i['type']),
            is_array($i['params'] ?? null) ? $i['params'] : [], $data, Locale::orDefault((string) ($i['locale'] ?? 'es')),
            Timestamps::fromDb((string) $i['createdAt']),
            (new DateTimeImmutable('@'.((int) $i['expiresAt'])))->setTimezone(new DateTimeZone('UTC')),
            isset($i['readAt']) ? Timestamps::fromDb((string) $i['readAt']) : null,
            DeliveryStatus::tryFrom((string) ($i['pushStatus'] ?? 'NONE')) ?? DeliveryStatus::None,
            DeliveryStatus::tryFrom((string) ($i['emailStatus'] ?? 'NONE')) ?? DeliveryStatus::None,
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function prefUpdate(string $userId, int $unreadInc, ?ProfileSync $profile, DateTimeImmutable $now): array
    {
        $sets = ['userId = :u'];
        $values = [':u' => $userId];
        if ($profile !== null) {
            $sets[] = '#locale = :loc';
            $sets[] = 'localeUpdatedAt = :lt';
            $sets[] = 'channels = if_not_exists(channels, :dch)';
            $sets[] = 'mutedTypes = if_not_exists(mutedTypes, :dmt)';
            $sets[] = 'updatedAt = if_not_exists(updatedAt, :now)';
            $values += [':loc' => $profile->locale->value, ':lt' => Timestamps::toDb($profile->eventTime), ':dch' => ['push' => true, 'email' => true, 'inApp' => true], ':dmt' => [], ':now' => Timestamps::toDb($now)];
            if ($profile->email !== null) {
                $sets[] = '#email = :em';
                $values[':em'] = $profile->email;
            }
        }
        $expression = 'SET '.implode(', ', $sets);
        if ($unreadInc > 0) {
            $expression .= ' ADD unreadCount :n';
            $values[':n'] = $unreadInc;
        }
        $update = [
            'TableName' => $this->table,
            'Key' => $this->marshaler->marshalItem(['pk' => 'USER#'.$userId, 'sk' => 'PREF']),
            'UpdateExpression' => $expression,
            'ExpressionAttributeValues' => $this->marshaler->marshalItem($values),
        ];
        if ($profile !== null) {
            $update['ExpressionAttributeNames'] = ['#locale' => 'locale'] + ($profile->email !== null ? ['#email' => 'email'] : []);
        }

        return $update;
    }
}
