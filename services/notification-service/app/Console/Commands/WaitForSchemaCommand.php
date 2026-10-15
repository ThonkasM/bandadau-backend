<?php

namespace App\Console\Commands;

use Bandada\Notification\InterfaceAdapters\Gateways\Dynamo\DynamoTables;
use Illuminate\Console\Command;
use Throwable;

class WaitForSchemaCommand extends Command
{
    protected $signature = 'bandada:wait-for-schema {--timeout=180 : Seconds to wait before failing}';

    protected $description = 'Block until the DynamoDB tables (created by bandadau-infra) exist; creates them only when DYNAMODB_AUTO_CREATE_TABLES=true';

    public function handle(DynamoTables $tables): int
    {
        $deadline = time() + (int) $this->option('timeout');
        $problems = ['not checked'];
        while (time() < $deadline) {
            try {
                $tables->createMissing();
                $problems = $tables->problems();
                if ($problems === []) {
                    return self::SUCCESS;
                }
            } catch (Throwable $e) {
                $problems = [$e->getMessage()];
            }
            $this->warn('waiting for DynamoDB: '.implode('; ', $problems));
            sleep(2);
        }
        $this->error('Timed out: '.implode('; ', $problems));

        return self::FAILURE;
    }
}
