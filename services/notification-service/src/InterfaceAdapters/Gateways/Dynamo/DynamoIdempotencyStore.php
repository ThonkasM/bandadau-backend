<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Gateways\Dynamo;

use Aws\DynamoDb\DynamoDbClient;
use Aws\DynamoDb\Exception\DynamoDbException;
use Aws\DynamoDb\Marshaler;
use Bandada\Notification\InterfaceAdapters\Shared\Exception\DependencyUnavailableException;
use Bandada\Notification\InterfaceAdapters\Shared\Idempotency\IdempotencyOutcome;
use Bandada\Notification\InterfaceAdapters\Shared\Idempotency\IdempotencyStore;

/** Implements idempotencia.md section 2.2 on the shared `bandada-idempotency` table (prefix `notification-service#`). */
final readonly class DynamoIdempotencyStore implements IdempotencyStore
{
    private const int MAX_BODY_BYTES = 300_000;

    public function __construct(
        private DynamoDbClient $client,
        private Marshaler $marshaler,
        private string $table,
        private string $service,
        private int $ttlSeconds,
        private int $lockSeconds,
    ) {}

    public function reserve(string $key, string $requestHash, string $principal): IdempotencyOutcome
    {
        $pk = $this->pk($key);
        for ($attempt = 0; $attempt < 3; $attempt++) {
            $now = time();
            try {
                $this->client->putItem([
                    'TableName' => $this->table,
                    'Item' => $this->marshaler->marshalItem([
                        'pk' => $pk,
                        'status' => 'IN_PROGRESS',
                        'requestHash' => $requestHash,
                        'principal' => $principal,
                        'lockExpiresAt' => $now + $this->lockSeconds,
                        'createdAt' => gmdate('Y-m-d\TH:i:s\Z', $now),
                        'expiresAt' => $now + $this->ttlSeconds,
                    ]),
                    'ConditionExpression' => 'attribute_not_exists(pk) OR expiresAt < :now',
                    'ExpressionAttributeValues' => [':now' => ['N' => (string) $now]],
                ]);

                return IdempotencyOutcome::reserved();
            } catch (DynamoDbException $e) {
                if ($e->getAwsErrorCode() !== 'ConditionalCheckFailedException') {
                    throw new DependencyUnavailableException('DynamoDB idempotency store failed: '.$e->getAwsErrorCode(), 0, $e);
                }
            }

            $item = $this->get($pk);
            if ($item === null) {
                continue;
            }
            if (($item['requestHash'] ?? null) !== $requestHash || ($item['principal'] ?? null) !== $principal) {
                return IdempotencyOutcome::keyReused();
            }
            if (($item['status'] ?? null) === 'COMPLETED') {
                /** @var array<string, string> $headers */
                $headers = is_array($item['responseHeaders'] ?? null) ? $item['responseHeaders'] : [];

                return IdempotencyOutcome::replay((int) $item['responseStatus'], $headers, (string) ($item['responseBody'] ?? ''));
            }
            if ((int) ($item['lockExpiresAt'] ?? 0) < $now && $this->takeOver($pk, $requestHash, $now)) {
                return IdempotencyOutcome::reserved();
            }

            return IdempotencyOutcome::inProgress();
        }

        return IdempotencyOutcome::inProgress();
    }

    public function complete(string $key, int $status, array $headers, string $body): void
    {
        if (strlen($body) > self::MAX_BODY_BYTES) {
            $this->release($key);

            return;
        }
        try {
            $this->client->updateItem([
                'TableName' => $this->table,
                'Key' => $this->marshaler->marshalItem(['pk' => $this->pk($key)]),
                'UpdateExpression' => 'SET #s = :c, responseStatus = :st, responseHeaders = :hd, responseBody = :b, completedAt = :t',
                'ConditionExpression' => '#s = :ip',
                'ExpressionAttributeNames' => ['#s' => 'status'],
                'ExpressionAttributeValues' => $this->marshaler->marshalItem([
                    ':c' => 'COMPLETED',
                    ':ip' => 'IN_PROGRESS',
                    ':st' => $status,
                    ':hd' => $headers,
                    ':b' => $body,
                    ':t' => gmdate('Y-m-d\TH:i:s\Z'),
                ]),
            ]);
        } catch (DynamoDbException $e) {
            if ($e->getAwsErrorCode() !== 'ConditionalCheckFailedException') {
                throw new DependencyUnavailableException('DynamoDB idempotency store failed: '.$e->getAwsErrorCode(), 0, $e);
            }
        }
    }

    public function release(string $key): void
    {
        try {
            $this->client->deleteItem([
                'TableName' => $this->table,
                'Key' => $this->marshaler->marshalItem(['pk' => $this->pk($key)]),
                'ConditionExpression' => '#s = :ip',
                'ExpressionAttributeNames' => ['#s' => 'status'],
                'ExpressionAttributeValues' => [':ip' => ['S' => 'IN_PROGRESS']],
            ]);
        } catch (DynamoDbException $e) {
            if ($e->getAwsErrorCode() !== 'ConditionalCheckFailedException') {
                throw new DependencyUnavailableException('DynamoDB idempotency store failed: '.$e->getAwsErrorCode(), 0, $e);
            }
        }
    }

    private function pk(string $key): string
    {
        return $this->service.'#'.$key;
    }

    /** @return array<string, mixed>|null */
    private function get(string $pk): ?array
    {
        try {
            $result = $this->client->getItem([
                'TableName' => $this->table,
                'Key' => $this->marshaler->marshalItem(['pk' => $pk]),
                'ConsistentRead' => true,
            ]);
        } catch (DynamoDbException $e) {
            throw new DependencyUnavailableException('DynamoDB idempotency store failed: '.$e->getAwsErrorCode(), 0, $e);
        }
        $item = $result['Item'] ?? null;

        if (! is_array($item)) {
            return null;
        }
        $plain = $this->marshaler->unmarshalItem($item);

        return is_array($plain) ? $plain : null;
    }

    private function takeOver(string $pk, string $requestHash, int $now): bool
    {
        try {
            $this->client->updateItem([
                'TableName' => $this->table,
                'Key' => $this->marshaler->marshalItem(['pk' => $pk]),
                'UpdateExpression' => 'SET lockExpiresAt = :lock',
                'ConditionExpression' => '#s = :ip AND lockExpiresAt < :now AND requestHash = :h',
                'ExpressionAttributeNames' => ['#s' => 'status'],
                'ExpressionAttributeValues' => $this->marshaler->marshalItem([
                    ':lock' => $now + $this->lockSeconds,
                    ':ip' => 'IN_PROGRESS',
                    ':now' => $now,
                    ':h' => $requestHash,
                ]),
            ]);

            return true;
        } catch (DynamoDbException $e) {
            if ($e->getAwsErrorCode() === 'ConditionalCheckFailedException') {
                return false;
            }
            throw new DependencyUnavailableException('DynamoDB idempotency store failed: '.$e->getAwsErrorCode(), 0, $e);
        }
    }
}
