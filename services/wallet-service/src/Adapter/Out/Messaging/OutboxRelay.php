<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Out\Messaging;

use Bandada\Wallet\Adapter\Shared\Amqp\AmqpConnectionFactory;
use Bandada\Wallet\Adapter\Shared\Logging\LogContext;
use Bandada\Wallet\Adapter\Shared\Messaging\Traceparent;
use Illuminate\Database\ConnectionInterface;
use PhpAmqpLib\Channel\AMQPChannel;
use PhpAmqpLib\Connection\AbstractConnection;
use PhpAmqpLib\Message\AMQPMessage;
use PhpAmqpLib\Wire\AMQPTable;
use Psr\Log\LoggerInterface;
use RuntimeException;
use Throwable;

/**
 * Publishes pending outbox rows with publisher confirms and `mandatory` (an unroutable message is a
 * configuration error, not a silent drop). Safe with several replicas: FOR UPDATE SKIP LOCKED.
 */
final class OutboxRelay
{
    private ?AbstractConnection $connection = null;

    private ?AMQPChannel $channel = null;

    private bool $failed = false;

    /** @var list<string> */
    private array $returned = [];

    public function __construct(
        private readonly ConnectionInterface $db,
        private readonly AmqpConnectionFactory $amqp,
        private readonly LoggerInterface $logger,
        private readonly int $batchSize = 100,
    ) {}

    /** @return int number of messages published (and confirmed) in this pass */
    public function runOnce(): int
    {
        $published = 0;
        $this->failed = false;
        try {
            $published = $this->db->transaction(function (): int {
                $rows = $this->db->select(
                    'SELECT id, exchange, routing_key, payload, headers FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT '
                    .$this->batchSize.' FOR UPDATE SKIP LOCKED',
                );
                if ($rows === []) {
                    return 0;
                }
                $channel = $this->channel();
                $this->returned = [];
                $ids = [];
                foreach ($rows as $row) {
                    $r = (array) $row;
                    $channel->basic_publish($this->message($row), (string) $r['exchange'], (string) $r['routing_key'], true);
                    $ids[] = (string) $r['id'];
                }
                $channel->wait_for_pending_acks_returns(5.0);
                if ($this->hasReturned()) {
                    throw new RuntimeException('Unroutable message(s) returned by the broker: '.implode(',', $this->returned));
                }
                $this->db->table('outbox')->whereIn('id', $ids)->update([
                    'published_at' => gmdate('Y-m-d\TH:i:s\Z'),
                    'attempts' => $this->db->raw('attempts + 1'),
                ]);

                return count($ids);
            });
        } catch (Throwable $e) {
            $this->logger->error('Outbox relay pass failed', ['event' => 'outbox.relay_failed', 'error' => $e->getMessage()]);
            $this->failed = true;
            $this->recordFailure($e);
            $this->reset();
        }
        if ($published > 0) {
            $this->logger->info('Outbox messages published', ['event' => 'outbox.published', 'count' => $published]);
        }

        return $published;
    }

    private function hasReturned(): bool
    {
        return $this->returned !== [];
    }

    public function lastPassFailed(): bool
    {
        return $this->failed;
    }

    public function purgePublished(int $retentionDays): int
    {
        return $this->db->table('outbox')
            ->whereNotNull('published_at')
            ->where('published_at', '<', gmdate('Y-m-d\TH:i:s\Z', time() - $retentionDays * 86400))
            ->delete();
    }

    public function close(): void
    {
        $this->reset();
    }

    private function message(object $row): AMQPMessage
    {
        $r = (array) $row;
        $payload = (string) $r['payload'];
        /** @var array<string, mixed> $decoded */
        $decoded = json_decode($payload, true, 32, JSON_THROW_ON_ERROR);
        $headers = json_decode((string) $r['headers'], true) ?: [];
        $traceparent = is_string($headers['traceparent'] ?? null) ? $headers['traceparent'] : Traceparent::generate();

        $properties = [
            'content_type' => 'application/cloudevents+json',
            'delivery_mode' => AMQPMessage::DELIVERY_MODE_PERSISTENT,
            'message_id' => (string) $r['id'],
            'type' => (string) $r['routing_key'],
            'timestamp' => time(),
            'application_headers' => new AMQPTable(['traceparent' => $traceparent]),
        ];
        if (isset($decoded['correlationid']) && is_string($decoded['correlationid'])) {
            $properties['correlation_id'] = $decoded['correlationid'];
        }

        return new AMQPMessage($payload, $properties);
    }

    private function channel(): AMQPChannel
    {
        if ($this->channel !== null && $this->channel->is_open()) {
            return $this->channel;
        }
        $this->connection = $this->amqp->connect('wallet-outbox-relay');
        $this->channel = $this->connection->channel();
        $this->channel->confirm_select();
        $this->channel->set_return_listener(function ($code, $text, $exchange, $routingKey): void {
            $this->returned[] = "{$exchange}/{$routingKey} ({$code} {$text})";
        });

        return $this->channel;
    }

    private function recordFailure(Throwable $e): void
    {
        try {
            $this->db->statement(
                'UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id IN (SELECT id FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT ?)',
                [mb_substr($e->getMessage(), 0, 500), $this->batchSize],
            );
        } catch (Throwable) {
        }
    }

    private function reset(): void
    {
        try {
            $this->channel?->close();
            $this->connection?->close();
        } catch (Throwable) {
        }
        $this->channel = null;
        $this->connection = null;
        LogContext::clear();
    }
}
