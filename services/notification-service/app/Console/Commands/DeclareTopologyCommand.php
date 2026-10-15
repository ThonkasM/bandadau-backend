<?php

namespace App\Console\Commands;

use Bandada\Notification\InterfaceAdapters\Shared\Amqp\AmqpConnectionFactory;
use Bandada\Notification\InterfaceAdapters\Shared\Amqp\Topology;
use Illuminate\Console\Command;

class DeclareTopologyCommand extends Command
{
    protected $signature = 'bandada:declare-topology';

    protected $description = 'Declare exchanges and the notification-service.commands queues (dev/tests only; production uses bandadau-infra definitions.json)';

    public function handle(AmqpConnectionFactory $amqp, Topology $topology): int
    {
        if (config('app.env') === 'production') {
            $this->error('Topology is owned by bandadau-infra in production.');

            return self::FAILURE;
        }
        $connection = $amqp->connect('notification-topology');
        $topology->declare($connection);
        $connection->close();
        $this->info('Topology declared.');

        return self::SUCCESS;
    }
}
