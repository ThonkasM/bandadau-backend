<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Gateways\Dynamo;

use Aws\DynamoDb\DynamoDbClient;
use Aws\DynamoDb\Exception\DynamoDbException;
use Aws\DynamoDb\Marshaler;
use Bandada\Notification\Entities\ChannelSet;
use Bandada\Notification\Entities\Locale;
use Bandada\Notification\Entities\NotificationPreference;
use Bandada\Notification\Entities\NotificationType;
use Bandada\Notification\InterfaceAdapters\Shared\Support\Timestamps;
use Bandada\Notification\UseCases\Ports\PreferenceRepository;
use DateTimeImmutable;

final readonly class DynamoPreferenceRepository implements PreferenceRepository
{
    public function __construct(private DynamoDbClient $client, private Marshaler $marshaler, private string $table) {}

    public function get(string $userId, DateTimeImmutable $now): NotificationPreference
    {
        try {
            $result = $this->client->getItem([
                'TableName' => $this->table,
                'Key' => $this->marshaler->marshalItem(['pk' => 'USER#'.$userId, 'sk' => 'PREF']),
                'ConsistentRead' => true,
            ]);
        } catch (DynamoDbException $e) {
            throw DynamoSupport::unavailable($e);
        }
        $raw = $result['Item'] ?? null;

        return is_array($raw) ? self::hydrate($userId, DynamoSupport::plain($this->marshaler, $raw), $now) : NotificationPreference::defaults($userId, $now);
    }

    public function save(string $userId, ChannelSet $channels, array $mutedTypes, DateTimeImmutable $now): NotificationPreference
    {
        try {
            $this->client->updateItem([
                'TableName' => $this->table,
                'Key' => $this->marshaler->marshalItem(['pk' => 'USER#'.$userId, 'sk' => 'PREF']),
                'UpdateExpression' => 'SET userId = :u, channels = :c, mutedTypes = :m, updatedAt = :t',
                'ExpressionAttributeValues' => $this->marshaler->marshalItem([
                    ':u' => $userId,
                    ':c' => ['push' => $channels->push, 'email' => $channels->email, 'inApp' => $channels->inApp],
                    ':m' => array_map(static fn (NotificationType $t): string => $t->value, $mutedTypes),
                    ':t' => Timestamps::toDb($now),
                ]),
            ]);
        } catch (DynamoDbException $e) {
            throw DynamoSupport::unavailable($e);
        }

        return $this->get($userId, $now);
    }

    /** @param array<string, mixed> $item */
    private static function hydrate(string $userId, array $item, DateTimeImmutable $now): NotificationPreference
    {
        $c = is_array($item['channels'] ?? null) ? $item['channels'] : [];
        $muted = [];
        foreach (is_array($item['mutedTypes'] ?? null) ? $item['mutedTypes'] : [] as $type) {
            $parsed = NotificationType::tryFrom((string) $type);
            if ($parsed !== null) {
                $muted[] = $parsed;
            }
        }

        return new NotificationPreference(
            $userId,
            new ChannelSet((bool) ($c['push'] ?? true), (bool) ($c['email'] ?? true), (bool) ($c['inApp'] ?? true)),
            $muted,
            Locale::orDefault(isset($item['locale']) ? (string) $item['locale'] : null),
            isset($item['email']) && is_string($item['email']) ? $item['email'] : null,
            isset($item['updatedAt']) ? Timestamps::fromDb((string) $item['updatedAt']) : $now,
            isset($item['localeUpdatedAt']) ? Timestamps::fromDb((string) $item['localeUpdatedAt']) : null,
            max(0, (int) ($item['unreadCount'] ?? 0)),
        );
    }
}
