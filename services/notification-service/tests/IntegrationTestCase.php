<?php

declare(strict_types=1);

namespace Tests;

use Bandada\Notification\InterfaceAdapters\Gateways\Dynamo\DynamoTables;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Http;
use Tests\Support\TestJwt;

/** Runs against real DynamoDB Local, RabbitMQ and Mailpit (see docker-compose.test.yml). */
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
            $tables = $this->app->make(DynamoTables::class);
            for ($i = 0; $i < 30; $i++) {
                try {
                    $tables->createMissing();
                    if ($tables->problems() === []) {
                        break;
                    }
                } catch (\Throwable) {
                    usleep(500_000);
                }
            }
            self::$prepared = true;
        }
        Http::fake(['identity.test/*' => Http::response(TestJwt::jwks())]);
        $this->withHeader('Accept', 'application/json')->withHeader('Accept-Language', 'es');
    }
}
