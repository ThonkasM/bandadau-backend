<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Schema;
use Throwable;

class WaitForSchemaCommand extends Command
{
    protected $signature = 'bandada:wait-for-schema {--timeout=180 : Seconds to wait before failing}';

    protected $description = 'Block until the wallet tables exist (the web role applies the migrations)';

    public function handle(): int
    {
        $deadline = time() + (int) $this->option('timeout');
        while (time() < $deadline) {
            try {
                if (Schema::hasTable('processed_messages') && Schema::hasTable('outbox') && Schema::hasTable('ledger_entries')) {
                    return self::SUCCESS;
                }
            } catch (Throwable) {
                // database not reachable yet
            }
            sleep(2);
        }
        $this->error('Timed out waiting for the wallet schema');

        return self::FAILURE;
    }
}
