<?php

declare(strict_types=1);

namespace Tests\Support;

use Bandada\Wallet\Adapter\In\Messaging\AmqpConsumer;
use Bandada\Wallet\Adapter\Out\Messaging\OutboxRelay;
use Bandada\Wallet\Adapter\Shared\Amqp\AmqpConnectionFactory;
use Bandada\Wallet\Adapter\Shared\Amqp\Topology;
use Illuminate\Contracts\Foundation\Application;
use PhpAmqpLib\Channel\AMQPChannel;
use PhpAmqpLib\Connection\AbstractConnection;
use PhpAmqpLib\Message\AMQPMessage;
use PhpAmqpLib\Wire\AMQPTable;
use Ramsey\Uuid\Uuid;

/** Talks to the real broker: publishes SAGA commands, runs the consumer/relay, reads published events. */
final class RabbitHarness
{
    public const EVENTS_PROBE_QUEUE = 'wallet-test.events-probe';

    private AbstractConnection $connection;

    private AMQPChannel $channel;

    public function __construct(private readonly Application $app)
    {
        $this->connection = $app->make(AmqpConnectionFactory::class)->connect('wallet-tests');
        $app->make(Topology::class)->declare($this->connection);
        $this->channel = $this->connection->channel();
        $this->channel->confirm_select();
        $this->channel->queue_declare(self::EVENTS_PROBE_QUEUE, false, false, true, true);
        $this->channel->queue_bind(self::EVENTS_PROBE_QUEUE, 'bandada.events', 'bandada.wallet.#');
        $this->purgeAll();
    }

    public function __destruct()
    {
        try {
            $this->channel->queue_delete(self::EVENTS_PROBE_QUEUE);
            $this->connection->close();
        } catch (\Throwable) {
        }
    }

    public function purgeAll(): void
    {
        foreach (['wallet-service.commands', 'wallet-service.commands.dlq', 'wallet-service.commands.retry.5s',
            'wallet-service.commands.retry.30s', 'wallet-service.commands.retry.5m', self::EVENTS_PROBE_QUEUE] as $queue) {
            $this->channel->queue_purge($queue);
        }
    }

    /** @param array<string, mixed> $data */
    public function command(string $type, array $data, ?string $id = null, array $extensions = []): string
    {
        $id ??= Uuid::uuid7()->toString();
        $body = json_encode(array_merge([
            'specversion' => '1.0',
            'id' => $id,
            'source' => '/services/events-service',
            'type' => $type,
            'time' => gmdate('Y-m-d\TH:i:s\Z'),
            'datacontenttype' => 'application/json',
            'sagaid' => $data['sagaId'] ?? null,
            'correlationid' => 'corr-'.substr($id, -6),
            'traceparent' => '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
            'data' => $data,
        ], $extensions), JSON_THROW_ON_ERROR);
        $this->publishRaw($body, $type, $id);

        return $id;
    }

    public function publishRaw(string $body, string $routingKey, ?string $messageId = null): void
    {
        $this->channel->basic_publish(new AMQPMessage($body, [
            'content_type' => 'application/cloudevents+json',
            'delivery_mode' => 2,
            'message_id' => $messageId ?? Uuid::uuid7()->toString(),
            'application_headers' => new AMQPTable(['traceparent' => '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01']),
        ]), 'bandada.commands', $routingKey, true);
        $this->channel->wait_for_pending_acks_returns(5);
    }

    public function consume(int $messages, int $idleSeconds = 4): void
    {
        $this->app->make(AmqpConsumer::class)->run($messages, $idleSeconds);
    }

    public function relay(): int
    {
        return $this->app->make(OutboxRelay::class)->runOnce();
    }

    /** @return list<array{event: array<string,mixed>, message: AMQPMessage}> */
    public function publishedEvents(): array
    {
        $out = [];
        for ($i = 0; $i < 50; $i++) {
            $message = $this->channel->basic_get(self::EVENTS_PROBE_QUEUE, true);
            if ($message === null) {
                usleep(100_000);
                $message = $this->channel->basic_get(self::EVENTS_PROBE_QUEUE, true);
                if ($message === null) {
                    break;
                }
            }
            $out[] = ['event' => json_decode($message->getBody(), true, 32, JSON_THROW_ON_ERROR), 'message' => $message];
        }

        return $out;
    }

    public function depth(string $queue): int
    {
        [, $count] = $this->channel->queue_declare($queue, true);

        return (int) $count;
    }

    /** @return array{0: AMQPMessage|null} */
    public function peek(string $queue): ?AMQPMessage
    {
        return $this->channel->basic_get($queue, true);
    }
}
