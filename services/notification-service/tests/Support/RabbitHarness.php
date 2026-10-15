<?php

declare(strict_types=1);

namespace Tests\Support;

use Bandada\Notification\InterfaceAdapters\Controllers\Messaging\AmqpConsumer;
use Bandada\Notification\InterfaceAdapters\Shared\Amqp\AmqpConnectionFactory;
use Bandada\Notification\InterfaceAdapters\Shared\Amqp\Topology;
use Illuminate\Contracts\Foundation\Application;
use PhpAmqpLib\Channel\AMQPChannel;
use PhpAmqpLib\Connection\AbstractConnection;
use PhpAmqpLib\Message\AMQPMessage;
use Ramsey\Uuid\Uuid;

/** Publishes domain events to the real broker and runs the real consumer. */
final class RabbitHarness
{
    private AbstractConnection $connection;

    private AMQPChannel $channel;

    public function __construct(private readonly Application $app)
    {
        $this->connection = $app->make(AmqpConnectionFactory::class)->connect('notification-tests');
        $app->make(Topology::class)->declare($this->connection);
        $this->channel = $this->connection->channel();
        $this->channel->confirm_select();
        foreach (['notification-service.events', 'notification-service.events.dlq', 'notification-service.events.retry.5s'] as $queue) {
            $this->channel->queue_purge($queue);
        }
    }

    public function __destruct()
    {
        try {
            $this->connection->close();
        } catch (\Throwable) {
        }
    }

    /** @param array<string, mixed> $data */
    public function event(string $type, array $data, ?string $id = null): string
    {
        $id ??= Uuid::uuid7()->toString();
        $this->raw(json_encode([
            'specversion' => '1.0', 'id' => $id, 'source' => '/services/test', 'type' => $type,
            'time' => gmdate('Y-m-d\TH:i:s\Z'), 'datacontenttype' => 'application/json',
            'correlationid' => 'corr-test', 'traceparent' => '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
            'data' => $data + ['occurredAt' => gmdate('Y-m-d\TH:i:s\Z')],
        ], JSON_THROW_ON_ERROR), $type, $id);

        return $id;
    }

    public function raw(string $body, string $routingKey, ?string $id = null): void
    {
        $this->channel->basic_publish(new AMQPMessage($body, [
            'content_type' => 'application/cloudevents+json', 'delivery_mode' => 2, 'message_id' => $id ?? Uuid::uuid7()->toString(),
        ]), 'bandada.events', $routingKey, true);
        $this->channel->wait_for_pending_acks_returns(5);
    }

    public function consume(int $messages, int $idleSeconds = 4): void
    {
        $this->app->make(AmqpConsumer::class)->run($messages, $idleSeconds);
    }

    public function depth(string $queue): int
    {
        [, $count] = $this->channel->queue_declare($queue, true);

        return (int) $count;
    }
}
