<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Gateways\Dynamo;

use Aws\DynamoDb\DynamoDbClient;
use Aws\DynamoDb\Exception\DynamoDbException;

/** Verifies (and, in dev/tests only, creates) the tables owned by bandadau-infra. */
final readonly class DynamoTables
{
    public function __construct(
        private DynamoDbClient $client,
        private string $notificationsTable,
        private string $idempotencyTable,
        private bool $autoCreate,
    ) {}

    /** @return list<string> problems; empty when everything required exists */
    public function problems(): array
    {
        $problems = [];
        try {
            $table = $this->client->describeTable(['TableName' => $this->notificationsTable])['Table'];
            $indexes = array_column($table['GlobalSecondaryIndexes'] ?? [], 'IndexName');
            if (! in_array('GSI1', $indexes, true)) {
                $problems[] = "table {$this->notificationsTable} has no GSI1";
            }
        } catch (DynamoDbException) {
            $problems[] = "table {$this->notificationsTable} does not exist";
        }
        try {
            $this->client->describeTable(['TableName' => $this->idempotencyTable]);
        } catch (DynamoDbException) {
            $problems[] = "table {$this->idempotencyTable} does not exist";
        }

        return $problems;
    }

    public function createMissing(): void
    {
        if (! $this->autoCreate) {
            return;
        }
        foreach ($this->problems() as $problem) {
            if (str_contains($problem, $this->notificationsTable) && str_contains($problem, 'does not exist')) {
                $this->client->createTable([
                    'TableName' => $this->notificationsTable,
                    'BillingMode' => 'PAY_PER_REQUEST',
                    'AttributeDefinitions' => [
                        ['AttributeName' => 'pk', 'AttributeType' => 'S'], ['AttributeName' => 'sk', 'AttributeType' => 'S'],
                        ['AttributeName' => 'gsi1pk', 'AttributeType' => 'S'], ['AttributeName' => 'gsi1sk', 'AttributeType' => 'S'],
                    ],
                    'KeySchema' => [['AttributeName' => 'pk', 'KeyType' => 'HASH'], ['AttributeName' => 'sk', 'KeyType' => 'RANGE']],
                    'GlobalSecondaryIndexes' => [[
                        'IndexName' => 'GSI1',
                        'KeySchema' => [['AttributeName' => 'gsi1pk', 'KeyType' => 'HASH'], ['AttributeName' => 'gsi1sk', 'KeyType' => 'RANGE']],
                        'Projection' => ['ProjectionType' => 'ALL'],
                    ]],
                ]);
            }
            if (str_contains($problem, $this->idempotencyTable) && str_contains($problem, 'does not exist')) {
                $this->client->createTable([
                    'TableName' => $this->idempotencyTable,
                    'BillingMode' => 'PAY_PER_REQUEST',
                    'AttributeDefinitions' => [['AttributeName' => 'pk', 'AttributeType' => 'S']],
                    'KeySchema' => [['AttributeName' => 'pk', 'KeyType' => 'HASH']],
                ]);
            }
        }
    }
}
