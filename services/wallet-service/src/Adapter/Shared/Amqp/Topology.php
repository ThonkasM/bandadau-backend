<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Shared\Amqp;

use PhpAmqpLib\Channel\AMQPChannel;
use PhpAmqpLib\Connection\AbstractConnection;
use PhpAmqpLib\Wire\AMQPTable;

/**
 * Queue topology of the catalog (catalogo-servicios §5, eventos-y-mensajeria §2.2). In production
 * bandadau-infra creates it from definitions.json: services only verify(); declare() is for dev/tests.
 */
final readonly class Topology
{
    public const array RETRY_DELAYS_MS = ['5s' => 5000, '30s' => 30000, '5m' => 300000];

    /** @param list<string> $bindings routing keys bound on the commands exchange */
    public function __construct(
        private string $queue,
        private string $bindingExchange,
        private array $bindings,
        private string $eventsExchange,
        private string $commandsExchange,
        private string $dlx,
        private int $deliveryLimit = 10,
    ) {}

    public function declare(AbstractConnection $connection): void
    {
        $ch = $connection->channel();
        foreach ([$this->eventsExchange, $this->commandsExchange, $this->dlx] as $exchange) {
            $ch->exchange_declare($exchange, 'topic', false, true, false);
        }
        $ch->queue_declare($this->queue, false, true, false, false, false, new AMQPTable([
            'x-queue-type' => 'quorum',
            'x-dead-letter-exchange' => $this->dlx,
            'x-dead-letter-routing-key' => $this->queue,
            'x-delivery-limit' => $this->deliveryLimit,
        ]));
        foreach ($this->bindings as $routingKey) {
            $ch->queue_bind($this->queue, $this->bindingExchange, $routingKey);
        }
        foreach (self::RETRY_DELAYS_MS as $suffix => $ttl) {
            $ch->queue_declare("{$this->queue}.retry.{$suffix}", false, true, false, false, false, new AMQPTable([
                'x-message-ttl' => $ttl,
                'x-dead-letter-exchange' => '',
                'x-dead-letter-routing-key' => $this->queue,
            ]));
        }
        $ch->queue_declare("{$this->queue}.dlq", false, true, false, false, false, new AMQPTable(['x-queue-type' => 'quorum']));
        $ch->queue_bind("{$this->queue}.dlq", $this->dlx, $this->queue);
        $ch->close();
    }

    /**
     * Passive checks, one channel per probe (a failed passive declare closes its channel).
     *
     * @return list<string> names of missing entities
     */
    public function missing(AbstractConnection $connection): array
    {
        $missing = [];
        $probes = [
            ['exchange', $this->eventsExchange], ['exchange', $this->commandsExchange], ['exchange', $this->dlx],
            ['queue', $this->queue], ['queue', "{$this->queue}.dlq"],
        ];
        foreach (array_keys(self::RETRY_DELAYS_MS) as $suffix) {
            $probes[] = ['queue', "{$this->queue}.retry.{$suffix}"];
        }
        foreach ($probes as [$kind, $name]) {
            $ch = $connection->channel();
            try {
                $kind === 'exchange'
                    ? $ch->exchange_declare($name, 'topic', true)
                    : $ch->queue_declare($name, true);
            } catch (\Throwable) {
                $missing[] = "{$kind}:{$name}";
            }
            $this->closeQuietly($ch);
        }

        return $missing;
    }

    private function closeQuietly(AMQPChannel $ch): void
    {
        try {
            $ch->close();
        } catch (\Throwable) {
        }
    }
}
