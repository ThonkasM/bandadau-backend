<?php

namespace App\Console\Commands;

use Bandada\Notification\InterfaceAdapters\Shared\Process\Heartbeat;
use Illuminate\Console\Command;

class RelayCommand extends Command
{
    protected $signature = 'notifications:relay-outbox {--once : Exit immediately}';

    protected $aliases = ['bandada:relay'];

    protected $description = 'Placeholder relay: notification-service publishes no events (terminal service), so there is no outbox to drain';

    public function handle(): int
    {
        $this->info('notification-service publishes no events in phase 1; nothing to relay. Idling (keeps the container healthy).');
        if ($this->option('once')) {
            return self::SUCCESS;
        }
        $stop = false;
        pcntl_async_signals(true);
        pcntl_signal(SIGTERM, static function () use (&$stop): void {
            $stop = true;
        });
        pcntl_signal(SIGINT, static function () use (&$stop): void {
            $stop = true;
        });
        while (! $stop) {
            Heartbeat::beat();
            sleep(5);
        }

        return self::SUCCESS;
    }
}
