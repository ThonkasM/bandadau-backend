<?php

namespace App\Console\Commands;

use App\Support\EnvironmentValidator;
use Bandada\Wallet\Adapter\Out\Messaging\OutboxRelay;
use Bandada\Wallet\Adapter\Shared\Process\Heartbeat;
use Bandada\Wallet\Application\Port\In\ExpireTopUpsUseCase;
use Illuminate\Console\Command;
use Psr\Log\LoggerInterface;

class RelayCommand extends Command
{
    protected $signature = 'bandada:relay {--once : Run a single pass and exit}';

    protected $aliases = ['bandada:outbox-relay', 'wallet:relay-outbox'];

    protected $description = 'Transactional outbox relay (outbox -> RabbitMQ) plus periodic housekeeping (top-up expiry, outbox purge)';

    public function handle(OutboxRelay $relay, ExpireTopUpsUseCase $expire, LoggerInterface $logger): int
    {
        EnvironmentValidator::assertValid();
        $stop = false;
        pcntl_async_signals(true);
        pcntl_signal(SIGTERM, static function () use (&$stop): void {
            $stop = true;
        });
        pcntl_signal(SIGINT, static function () use (&$stop): void {
            $stop = true;
        });

        $pollMicros = max(50, (int) config('wallet.outbox.poll_interval_ms')) * 1000;
        $lastHousekeeping = 0;
        $lastPurge = 0;

        do {
            Heartbeat::beat();
            $published = $relay->runOnce();
            if (time() - $lastHousekeeping >= 60) {
                $lastHousekeeping = time();
                try {
                    $expired = $expire->handle();
                    if ($expired > 0) {
                        $logger->info('Top-ups expired', ['event' => 'topup.expired', 'count' => $expired]);
                    }
                    if (time() - $lastPurge >= 86400) {
                        $lastPurge = time();
                        $relay->purgePublished((int) config('wallet.outbox.retention_days'));
                    }
                } catch (\Throwable $e) {
                    $logger->error('Housekeeping failed', ['event' => 'relay.housekeeping_failed', 'error' => $e->getMessage()]);
                }
            }
            if ($this->option('once')) {
                break;
            }
            if ($relay->lastPassFailed()) {
                sleep(2);
            } elseif ($published === 0) {
                usleep($pollMicros);
            }
        } while (! $stop);

        $relay->close();

        return self::SUCCESS;
    }
}
