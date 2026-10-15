<?php

namespace App\Console\Commands;

use App\Support\EnvironmentValidator;
use Bandada\Notification\InterfaceAdapters\Controllers\Messaging\AmqpConsumer;
use Bandada\Notification\InterfaceAdapters\Shared\Amqp\AmqpConnectionFactory;
use Bandada\Notification\InterfaceAdapters\Shared\Amqp\Topology;
use Illuminate\Console\Command;

class ConsumeCommand extends Command
{
    protected $signature = 'notifications:consume
        {--max-messages=0 : Stop after N messages (0 = run forever)}
        {--idle-exit=0 : Stop after N idle seconds (0 = never)}';

    protected $aliases = ['bandada:consume'];

    protected $description = 'Long-running consumer of the notification-service.events queue (UC-24)';

    public function handle(AmqpConsumer $consumer): int
    {
        EnvironmentValidator::assertValid();
        pcntl_async_signals(true);
        pcntl_signal(SIGTERM, static fn () => $consumer->requestStop());
        pcntl_signal(SIGINT, static fn () => $consumer->requestStop());

        if (config('notification.rabbitmq.declare_topology')) {
            app(Topology::class)->declare(app(AmqpConnectionFactory::class)->connect('notification-topology'));
        }
        $consumer->run((int) $this->option('max-messages'), (int) $this->option('idle-exit'));

        return self::SUCCESS;
    }
}
