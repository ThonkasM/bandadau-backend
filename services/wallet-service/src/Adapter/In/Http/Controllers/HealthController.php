<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Http\Controllers;

use Aws\DynamoDb\DynamoDbClient;
use Bandada\Wallet\Adapter\Shared\Amqp\AmqpConnectionFactory;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Http\JsonResponse;
use Throwable;

final readonly class HealthController
{
    public function __construct(
        private ConnectionInterface $db,
        private AmqpConnectionFactory $amqp,
        private DynamoDbClient $dynamo,
        private string $idempotencyTable,
    ) {}

    public function live(): JsonResponse
    {
        return new JsonResponse(['status' => 'UP']);
    }

    public function ready(): JsonResponse
    {
        $checks = [
            'database' => $this->probe(fn () => $this->db->selectOne('SELECT 1')),
            'rabbitmq' => $this->probe(function (): void {
                $connection = $this->amqp->connect('wallet-health');
                $connection->close();
            }),
            'idempotencyStore' => $this->probe(fn () => $this->dynamo->describeTable(['TableName' => $this->idempotencyTable])),
        ];
        $up = ! in_array('DOWN', $checks, true);

        return new JsonResponse(['status' => $up ? 'UP' : 'DOWN', 'checks' => $checks], $up ? 200 : 503);
    }

    private function probe(callable $check): string
    {
        try {
            $check();

            return 'UP';
        } catch (Throwable) {
            return 'DOWN';
        }
    }
}
