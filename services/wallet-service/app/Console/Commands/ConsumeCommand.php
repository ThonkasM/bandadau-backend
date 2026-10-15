<?php

namespace App\Console\Commands;

use App\Support\EnvironmentValidator;
use Bandada\Wallet\Adapter\In\Messaging\AmqpConsumer;
use Bandada\Wallet\Adapter\Shared\Amqp\AmqpConnectionFactory;
use Bandada\Wallet\Adapter\Shared\Amqp\Topology;
use Illuminate\Console\Command;

class ConsumeCommand extends Command
{
    protected $signature = 'bandada:consume
        {queue=wallet-service.commands : Queue to consume (only the commands queue is supported)}
        {--max-messages=0 : Stop after N messages (0 = run forever)}
        {--idle-exit=0 : Stop after N idle seconds (0 = never)}';

    protected $aliases = ['wallet:consume-commands'];

    protected $description = 'Long-running consumer of the SAGA commands (debit-credits, refund-credits)';

    public function handle(AmqpConsumer $consumer): int
    {
        EnvironmentValidator::assertValid();
        if ($this->argument('queue') !== config('wallet.rabbitmq.commands_queue')) {
            $this->error('wallet-service only consumes '.config('wallet.rabbitmq.commands_queue'));

            return self::INVALID;
        }
        pcntl_async_signals(true);
        pcntl_signal(SIGTERM, static fn () => $consumer->requestStop());
        pcntl_signal(SIGINT, static fn () => $consumer->requestStop());

        if ((int) config('wallet.chaos.wallet_delay_ms') > 0) {
            $this->warn('CHAOS_WALLET_DELAY_MS is active (demo only)');
        }
        if (config('wallet.rabbitmq.declare_topology')) {
            app(Topology::class)->declare(
                app(AmqpConnectionFactory::class)->connect('wallet-topology'),
            );
        }

        $consumer->run((int) $this->option('max-messages'), (int) $this->option('idle-exit'));

        return self::SUCCESS;
    }
}
