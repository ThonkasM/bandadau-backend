<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Messaging;

use Bandada\Wallet\Adapter\Shared\Amqp\AmqpConnectionFactory;
use Bandada\Wallet\Adapter\Shared\Amqp\Topology;
use Bandada\Wallet\Adapter\Shared\Logging\LogContext;
use Bandada\Wallet\Adapter\Shared\Messaging\CloudEvent;
use Bandada\Wallet\Adapter\Shared\Messaging\Exception\InvalidMessageException;
use Bandada\Wallet\Adapter\Shared\Messaging\Traceparent;
use Bandada\Wallet\Adapter\Shared\Process\Heartbeat;
use Bandada\Wallet\Domain\Exception\DomainException;
use PhpAmqpLib\Channel\AMQPChannel;
use PhpAmqpLib\Connection\AbstractConnection;
use PhpAmqpLib\Exception\AMQPTimeoutException;
use PhpAmqpLib\Message\AMQPMessage;
use PhpAmqpLib\Wire\AMQPTable;
use Psr\Log\LoggerInterface;
use Throwable;

/**
 * Long-running consumer (eventos-y-mensajeria.md sections 2.3, 2.4, 6): manual ack after commit,
 * transient failures go to the wait queues (5s, 30s, 5m) up to 3 times and then to the DLQ,
 * permanent failures go straight to the DLQ, reconnects with backoff, stops cleanly on SIGTERM.
 */
final class AmqpConsumer
{
    private bool $stop = false;

    private int $processed = 0;

    public function __construct(
        private readonly AmqpConnectionFactory $amqp,
        private readonly Topology $topology,
        private readonly WalletCommandHandler $handler,
        private readonly LoggerInterface $logger,
        private readonly string $queue,
        private readonly int $prefetch,
        private readonly int $maxRetries,
        private readonly int $chaosDelayMs = 0,
    ) {}

    private function stopped(): bool
    {
        return $this->stop;
    }

    public function requestStop(): void
    {
        $this->stop = true;
    }

    /**
     * @param  int  $maxMessages  stop after N messages (0 = unlimited; used by tests)
     * @param  int  $idleExitSeconds  stop after N seconds without messages (0 = never)
     */
    public function run(int $maxMessages = 0, int $idleExitSeconds = 0): void
    {
        $backoff = 1;
        while (! $this->stop) {
            $connection = null;
            try {
                $connection = $this->amqp->connect('wallet-consumer');
                $missing = $this->topology->missing($connection);
                if ($missing !== []) {
                    throw new \RuntimeException('RabbitMQ topology not ready, missing: '.implode(', ', $missing));
                }
                $backoff = 1;
                $this->consume($connection, $maxMessages, $idleExitSeconds);
                if ($maxMessages > 0 && $this->processed >= $maxMessages) {
                    break;
                }
                if ($idleExitSeconds > 0) {
                    break;
                }
            } catch (Throwable $e) {
                $this->logger->warning('Consumer connection problem, retrying', [
                    'event' => 'consumer.reconnect', 'error' => $e->getMessage(), 'retryInSeconds' => $backoff,
                ]);
                for ($i = 0; $i < $backoff && ! $this->stopped(); $i++) {
                    Heartbeat::beat();
                    sleep(1);
                }
                $backoff = min($backoff * 2, 30);
            } finally {
                $this->closeQuietly($connection);
            }
        }
        $this->logger->info('Consumer stopped', ['event' => 'consumer.stopped', 'processed' => $this->processed]);
    }

    private function consume(AbstractConnection $connection, int $maxMessages, int $idleExitSeconds): void
    {
        $channel = $connection->channel();
        $publisher = $connection->channel();
        $publisher->confirm_select();
        $channel->basic_qos(0, $this->prefetch, false);
        $channel->basic_consume(
            $this->queue,
            '',
            false,
            false,
            false,
            false,
            fn (AMQPMessage $m) => $this->onMessage($m, $publisher),
        );
        $this->logger->info('Consumer ready', ['event' => 'consumer.ready', 'queue' => $this->queue]);

        $idleSince = time();
        while ($channel->is_consuming() && ! $this->stop) {
            Heartbeat::beat();
            $before = $this->processed;
            try {
                $channel->wait(null, false, 1.0);
            } catch (AMQPTimeoutException) {
                // idle tick
            }
            if ($this->processed !== $before) {
                $idleSince = time();
            }
            if ($maxMessages > 0 && $this->processed >= $maxMessages) {
                return;
            }
            if ($idleExitSeconds > 0 && time() - $idleSince >= $idleExitSeconds) {
                return;
            }
        }
    }

    private function onMessage(AMQPMessage $message, AMQPChannel $publisher): void
    {
        $event = null;
        try {
            if ($this->chaosDelayMs > 0) {
                $this->logger->warning('Chaos: delaying command processing', ['event' => 'chaos.injected', 'delayMs' => $this->chaosDelayMs]);
                usleep($this->chaosDelayMs * 1000);
            }
            $event = CloudEvent::fromJson($message->getBody());
            LogContext::set($event->correlationId, Traceparent::traceId($event->traceparent));
            $this->handler->handle($event);
            $message->ack();
            $this->logger->info('Message processed', ['event' => 'message.processed', 'type' => $event->type, 'messageId' => $event->id]);
        } catch (InvalidMessageException|DomainException $e) {
            $this->logger->error('Permanent message failure, sent to DLQ', [
                'event' => 'message.rejected', 'type' => $event?->type, 'messageId' => $event !== null ? $event->id : ($message->get_properties()['message_id'] ?? null), 'error' => $e->getMessage(),
            ]);
            $message->nack(false);
        } catch (Throwable $e) {
            $this->retryOrDeadLetter($message, $publisher, $e, $event);
        } finally {
            $this->processed++;
            LogContext::clear();
        }
    }

    private function retryOrDeadLetter(AMQPMessage $message, AMQPChannel $publisher, Throwable $e, ?CloudEvent $event): void
    {
        $headers = $message->has('application_headers') ? $message->get('application_headers')->getNativeData() : [];
        $attempt = (int) ($headers['x-retry-count'] ?? 0);

        if ($attempt >= $this->maxRetries) {
            $this->logger->error('Retries exhausted, sent to DLQ', [
                'event' => 'message.dead_lettered', 'messageId' => $event?->id, 'error' => $e->getMessage(),
            ]);
            $message->nack(false);

            return;
        }

        $suffix = array_keys(Topology::RETRY_DELAYS_MS)[$attempt];
        $headers['x-retry-count'] = $attempt + 1;
        $headers['x-last-error'] = mb_substr($e->getMessage(), 0, 200);
        $properties = $message->get_properties();
        $properties['application_headers'] = new AMQPTable($headers);
        $copy = new AMQPMessage($message->getBody(), $properties);

        try {
            $publisher->basic_publish($copy, '', "{$this->queue}.retry.{$suffix}");
            $publisher->wait_for_pending_acks(5.0);
            $message->ack();
            $this->logger->warning('Transient failure, scheduled retry', [
                'event' => 'message.retry', 'messageId' => $event?->id, 'attempt' => $attempt + 1, 'wait' => $suffix, 'error' => $e->getMessage(),
            ]);
        } catch (Throwable $publishError) {
            // Could not park the message: let the broker redeliver it (requeue) rather than lose it.
            $this->logger->error('Could not schedule retry, requeueing', ['event' => 'message.requeue', 'error' => $publishError->getMessage()]);
            $message->nack(true);
        }
    }

    private function closeQuietly(?AbstractConnection $connection): void
    {
        try {
            $connection?->close();
        } catch (Throwable) {
        }
    }
}
