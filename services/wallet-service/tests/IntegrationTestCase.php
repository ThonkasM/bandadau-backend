<?php

declare(strict_types=1);

namespace Tests;

use Aws\DynamoDb\DynamoDbClient;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Support\TestJwt;

/**
 * Runs against real PostgreSQL, DynamoDB Local and RabbitMQ (see docker-compose.test.yml).
 */
abstract class IntegrationTestCase extends BaseTestCase
{
    private static bool $prepared = false;

    public function createApplication(): Application
    {
        $app = require __DIR__.'/../bootstrap/app.php';
        $app->make(Kernel::class)->bootstrap();

        return $app;
    }

    protected function setUp(): void
    {
        parent::setUp();
        if (! self::$prepared) {
            Artisan::call('migrate:fresh', ['--force' => true]);
            $this->ensureIdempotencyTable();
            self::$prepared = true;
        }
        DB::unprepared('TRUNCATE processed_messages, outbox, top_ups, ledger_entries, wallets');
        Http::fake(['identity.test/*' => Http::response(TestJwt::jwks())]);
        $this->withHeader('Accept', 'application/json')->withHeader('Accept-Language', 'es');
    }

    private function ensureIdempotencyTable(): void
    {
        /** @var DynamoDbClient $client */
        $client = $this->app->make(DynamoDbClient::class);
        $table = (string) config('wallet.idempotency.table');
        for ($attempt = 0; $attempt < 30; $attempt++) {
            try {
                $client->describeTable(['TableName' => $table]);

                return;
            } catch (\Throwable) {
                try {
                    $client->createTable([
                        'TableName' => $table,
                        'AttributeDefinitions' => [['AttributeName' => 'pk', 'AttributeType' => 'S']],
                        'KeySchema' => [['AttributeName' => 'pk', 'KeyType' => 'HASH']],
                        'BillingMode' => 'PAY_PER_REQUEST',
                    ]);

                    return;
                } catch (\Throwable) {
                    usleep(500_000);
                }
            }
        }
        throw new \RuntimeException('DynamoDB Local is not reachable');
    }
}
