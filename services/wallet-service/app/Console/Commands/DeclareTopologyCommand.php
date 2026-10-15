<?php

namespace App\Console\Commands;

use Bandada\Wallet\Adapter\Shared\Amqp\AmqpConnectionFactory;
use Bandada\Wallet\Adapter\Shared\Amqp\Topology;
use Illuminate\Console\Command;

class DeclareTopologyCommand extends Command
{
    protected $signature = 'bandada:declare-topology';

    protected $description = 'Declare exchanges and the wallet-service.commands queues (dev/tests only; production uses bandadau-infra definitions.json)';

    public function handle(AmqpConnectionFactory $amqp, Topology $topology): int
    {
        if (config('app.env') === 'production') {
            $this->error('Topology is owned by bandadau-infra in production.');

            return self::FAILURE;
        }
        $connection = $amqp->connect('wallet-topology');
        $topology->declare($connection);
        $connection->close();
        $this->info('Topology declared.');

        return self::SUCCESS;
    }
}
