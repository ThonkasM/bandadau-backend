<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Controllers\Http;

use Bandada\Notification\InterfaceAdapters\Gateways\Dynamo\DynamoTables;
use Bandada\Notification\InterfaceAdapters\Shared\Amqp\AmqpConnectionFactory;
use Illuminate\Http\JsonResponse;
use Throwable;

final readonly class HealthController
{
    public function __construct(private AmqpConnectionFactory $amqp, private DynamoTables $tables) {}

    public function live(): JsonResponse
    {
        return new JsonResponse(['status' => 'UP']);
    }

    public function ready(): JsonResponse
    {
        $checks = [
            'dynamodb' => $this->probe(function (): void {
                if ($this->tables->problems() !== []) {
                    throw new \RuntimeException('tables missing');
                }
            }),
            'rabbitmq' => $this->probe(function (): void {
                $this->amqp->connect('notification-health')->close();
            }),
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
