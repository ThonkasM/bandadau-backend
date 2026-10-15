<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Gateways\Dynamo;

use Aws\DynamoDb\DynamoDbClient;
use Aws\DynamoDb\Exception\DynamoDbException;
use Aws\DynamoDb\Marshaler;
use Bandada\Notification\Entities\DevicePlatform;
use Bandada\Notification\Entities\DeviceToken;
use Bandada\Notification\InterfaceAdapters\Shared\Support\Timestamps;
use Bandada\Notification\UseCases\Ports\DeviceRepository;

/** DEVICE items: pk USER#<u> / sk DEVICE#<token>; GSI1 (DEVICE#<token>) finds a token's current owner. */
final readonly class DynamoDeviceRepository implements DeviceRepository
{
    public function __construct(private DynamoDbClient $client, private Marshaler $marshaler, private string $table) {}

    public function register(DeviceToken $device): DeviceToken
    {
        try {
            $owners = $this->client->query([
                'TableName' => $this->table,
                'IndexName' => 'GSI1',
                'KeyConditionExpression' => 'gsi1pk = :g',
                'ExpressionAttributeValues' => [':g' => ['S' => 'DEVICE#'.$device->token]],
            ]);
            foreach ($owners['Items'] ?? [] as $item) {
                $plain = DynamoSupport::plain($this->marshaler, $item);
                if (($plain['pk'] ?? null) !== 'USER#'.$device->userId) {
                    $this->client->deleteItem(['TableName' => $this->table, 'Key' => $this->marshaler->marshalItem(['pk' => $plain['pk'], 'sk' => $plain['sk']])]);
                }
            }
            $now = Timestamps::toDb($device->lastSeenAt);
            $result = $this->client->updateItem([
                'TableName' => $this->table,
                'Key' => $this->marshaler->marshalItem(['pk' => 'USER#'.$device->userId, 'sk' => 'DEVICE#'.$device->token]),
                'UpdateExpression' => 'SET userId = :u, #token = :tk, platform = :p, appVersion = :av, deviceName = :dn, lastSeenAt = :now, '
                    .'registeredAt = if_not_exists(registeredAt, :now), gsi1pk = :g1p, gsi1sk = :g1s',
                'ExpressionAttributeNames' => ['#token' => 'token'],
                'ExpressionAttributeValues' => $this->marshaler->marshalItem([
                    ':u' => $device->userId, ':tk' => $device->token, ':p' => $device->platform->value,
                    ':av' => $device->appVersion, ':dn' => $device->deviceName, ':now' => $now,
                    ':g1p' => 'DEVICE#'.$device->token, ':g1s' => 'USER#'.$device->userId,
                ]),
                'ReturnValues' => 'ALL_NEW',
            ]);
        } catch (DynamoDbException $e) {
            throw DynamoSupport::unavailable($e);
        }

        return $this->hydrate(DynamoSupport::plain($this->marshaler, $result['Attributes']));
    }

    public function remove(string $userId, string $token): void
    {
        try {
            $this->client->deleteItem(['TableName' => $this->table, 'Key' => $this->marshaler->marshalItem(['pk' => 'USER#'.$userId, 'sk' => 'DEVICE#'.$token])]);
        } catch (DynamoDbException $e) {
            throw DynamoSupport::unavailable($e);
        }
    }

    public function forUser(string $userId): array
    {
        try {
            $result = $this->client->query([
                'TableName' => $this->table,
                'KeyConditionExpression' => 'pk = :pk AND begins_with(sk, :d)',
                'ExpressionAttributeValues' => [':pk' => ['S' => 'USER#'.$userId], ':d' => ['S' => 'DEVICE#']],
            ]);
        } catch (DynamoDbException $e) {
            throw DynamoSupport::unavailable($e);
        }

        return array_values(array_map(fn (array $i): DeviceToken => $this->hydrate(DynamoSupport::plain($this->marshaler, $i)), $result['Items'] ?? []));
    }

    /** @param array<string, mixed> $i */
    private function hydrate(array $i): DeviceToken
    {
        return new DeviceToken(
            (string) $i['token'], (string) $i['userId'], DevicePlatform::from((string) $i['platform']),
            isset($i['appVersion']) ? (string) $i['appVersion'] : null,
            isset($i['deviceName']) ? (string) $i['deviceName'] : null,
            Timestamps::fromDb((string) $i['registeredAt']), Timestamps::fromDb((string) $i['lastSeenAt']),
        );
    }
}
