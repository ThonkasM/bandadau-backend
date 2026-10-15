<?php

namespace App\Providers;

use App\Support\EnvironmentValidator;
use Aws\DynamoDb\DynamoDbClient;
use Aws\DynamoDb\Marshaler;
use Bandada\Wallet\Adapter\In\Http\Controllers\HealthController;
use Bandada\Wallet\Adapter\In\Http\Controllers\PaymentWebhookController;
use Bandada\Wallet\Adapter\In\Http\Controllers\TopUpController;
use Bandada\Wallet\Adapter\In\Http\Middleware\AuthenticateJwt;
use Bandada\Wallet\Adapter\In\Http\Middleware\RequestContext;
use Bandada\Wallet\Adapter\In\Http\Security\JwksKeyProvider;
use Bandada\Wallet\Adapter\In\Http\Security\JwtVerifier;
use Bandada\Wallet\Adapter\In\Messaging\AmqpConsumer;
use Bandada\Wallet\Adapter\In\Messaging\WalletCommandHandler;
use Bandada\Wallet\Adapter\Out\External\DynamoIdempotencyStore;
use Bandada\Wallet\Adapter\Out\External\SimulatedPaymentGateway;
use Bandada\Wallet\Adapter\Out\External\SystemClock;
use Bandada\Wallet\Adapter\Out\External\UuidV7Generator;
use Bandada\Wallet\Adapter\Out\Messaging\CloudEventFactory;
use Bandada\Wallet\Adapter\Out\Messaging\OutboxEventPublisher;
use Bandada\Wallet\Adapter\Out\Messaging\OutboxRelay;
use Bandada\Wallet\Adapter\Out\Persistence\PgInbox;
use Bandada\Wallet\Adapter\Out\Persistence\PgLedgerRepository;
use Bandada\Wallet\Adapter\Out\Persistence\PgLedgerStatsRepository;
use Bandada\Wallet\Adapter\Out\Persistence\PgTopUpRepository;
use Bandada\Wallet\Adapter\Out\Persistence\PgWalletRepository;
use Bandada\Wallet\Adapter\Out\Persistence\PostgresTransactionManager;
use Bandada\Wallet\Adapter\Shared\Amqp\AmqpConnectionFactory;
use Bandada\Wallet\Adapter\Shared\Amqp\Topology;
use Bandada\Wallet\Adapter\Shared\Idempotency\IdempotencyStore;
use Bandada\Wallet\Application\Port\In\CreateTopUpUseCase;
use Bandada\Wallet\Application\Port\In\DebitCreditsUseCase;
use Bandada\Wallet\Application\Port\In\ExpireTopUpsUseCase;
use Bandada\Wallet\Application\Port\In\GetCreditStatsUseCase;
use Bandada\Wallet\Application\Port\In\GetMyWalletUseCase;
use Bandada\Wallet\Application\Port\In\GetTopUpUseCase;
use Bandada\Wallet\Application\Port\In\HandlePaymentWebhookUseCase;
use Bandada\Wallet\Application\Port\In\ListLedgerEntriesUseCase;
use Bandada\Wallet\Application\Port\In\RefundCreditsUseCase;
use Bandada\Wallet\Application\Port\In\SimulatePaymentUseCase;
use Bandada\Wallet\Application\Port\Out\Clock;
use Bandada\Wallet\Application\Port\Out\EventPublisher;
use Bandada\Wallet\Application\Port\Out\IdGenerator;
use Bandada\Wallet\Application\Port\Out\Inbox;
use Bandada\Wallet\Application\Port\Out\LedgerRepository;
use Bandada\Wallet\Application\Port\Out\LedgerStatsRepository;
use Bandada\Wallet\Application\Port\Out\PaymentGateway;
use Bandada\Wallet\Application\Port\Out\TopUpRepository;
use Bandada\Wallet\Application\Port\Out\TransactionManager;
use Bandada\Wallet\Application\Port\Out\WalletRepository;
use Bandada\Wallet\Application\UseCase\CreateTopUpService;
use Bandada\Wallet\Application\UseCase\DebitCreditsService;
use Bandada\Wallet\Application\UseCase\ExpireTopUpsService;
use Bandada\Wallet\Application\UseCase\GetCreditStatsService;
use Bandada\Wallet\Application\UseCase\GetMyWalletService;
use Bandada\Wallet\Application\UseCase\GetTopUpService;
use Bandada\Wallet\Application\UseCase\HandlePaymentWebhookService;
use Bandada\Wallet\Application\UseCase\ListLedgerEntriesService;
use Bandada\Wallet\Application\UseCase\RefundCreditsService;
use Bandada\Wallet\Application\UseCase\SimulatePaymentService;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\ServiceProvider;
use Psr\Log\LoggerInterface;

/** Composition root: the only place that knows which adapter implements which port. */
class WalletServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->registerInfrastructure();
        $this->registerPorts();
        $this->registerUseCases();
        $this->registerAdapters();
    }

    public function boot(): void
    {
        if (! $this->app->runningInConsole() && ! $this->app->runningUnitTests()) {
            EnvironmentValidator::assertValid();
        }
    }

    private function registerInfrastructure(): void
    {
        $this->app->singleton(RequestContext::class);
        $this->app->singleton(AmqpConnectionFactory::class, fn (): AmqpConnectionFactory => new AmqpConnectionFactory((string) config('wallet.rabbitmq.url')));
        $this->app->singleton(DynamoDbClient::class, function (): DynamoDbClient {
            $c = config('wallet.dynamodb');
            $args = [
                'version' => '2012-08-10',
                'region' => $c['region'],
                'http' => ['timeout' => 3, 'connect_timeout' => 1],
                'retries' => ['mode' => 'standard', 'max_attempts' => 2],
            ];
            if ($c['endpoint'] !== null) {
                $args['endpoint'] = $c['endpoint'];
            }
            if ($c['key'] !== '' && $c['secret'] !== '') {
                $args['credentials'] = ['key' => $c['key'], 'secret' => $c['secret']];
            }

            return new DynamoDbClient($args);
        });
        $this->app->singleton(Topology::class, fn (): Topology => new Topology(
            (string) config('wallet.rabbitmq.commands_queue'),
            (string) config('wallet.rabbitmq.commands_exchange'),
            ['bandada.wallet.cmd.#'],
            (string) config('wallet.rabbitmq.events_exchange'),
            (string) config('wallet.rabbitmq.commands_exchange'),
            (string) config('wallet.rabbitmq.dlx'),
        ));
    }

    private function registerPorts(): void
    {
        $this->app->singleton(Clock::class, SystemClock::class);
        $this->app->singleton(IdGenerator::class, UuidV7Generator::class);
        $this->app->bind(TransactionManager::class, PostgresTransactionManager::class);
        $this->app->bind(WalletRepository::class, PgWalletRepository::class);
        $this->app->bind(LedgerRepository::class, PgLedgerRepository::class);
        $this->app->bind(TopUpRepository::class, PgTopUpRepository::class);
        $this->app->bind(Inbox::class, PgInbox::class);
        $this->app->bind(LedgerStatsRepository::class, PgLedgerStatsRepository::class);
        $this->app->bind(PaymentGateway::class, fn (): PaymentGateway => new SimulatedPaymentGateway(
            (string) config('wallet.payment.checkout_base_url'),
            (bool) config('wallet.payment.simulator_enabled'),
        ));
        $this->app->bind(EventPublisher::class, fn (Application $app): EventPublisher => new OutboxEventPublisher(
            $app->make(ConnectionInterface::class),
            new CloudEventFactory,
            $app->make(IdGenerator::class),
            $app->make(Clock::class),
            (string) config('wallet.rabbitmq.events_exchange'),
        ));
        $this->app->singleton(IdempotencyStore::class, fn (Application $app): IdempotencyStore => new DynamoIdempotencyStore(
            $app->make(DynamoDbClient::class),
            new Marshaler,
            (string) config('wallet.idempotency.table'),
            (string) config('wallet.service'),
            (int) config('wallet.idempotency.ttl_seconds'),
            (int) config('wallet.idempotency.lock_seconds'),
        ));
    }

    private function registerUseCases(): void
    {
        $this->app->bind(GetMyWalletUseCase::class, GetMyWalletService::class);
        $this->app->bind(ListLedgerEntriesUseCase::class, ListLedgerEntriesService::class);
        $this->app->bind(GetTopUpUseCase::class, GetTopUpService::class);
        $this->app->bind(HandlePaymentWebhookUseCase::class, HandlePaymentWebhookService::class);
        $this->app->bind(SimulatePaymentUseCase::class, SimulatePaymentService::class);
        $this->app->bind(DebitCreditsUseCase::class, DebitCreditsService::class);
        $this->app->bind(RefundCreditsUseCase::class, RefundCreditsService::class);
        $this->app->bind(GetCreditStatsUseCase::class, GetCreditStatsService::class);
        $this->app->bind(ExpireTopUpsUseCase::class, ExpireTopUpsService::class);
        $this->app->bind(CreateTopUpUseCase::class, fn (Application $app): CreateTopUpUseCase => new CreateTopUpService(
            $app->make(TopUpRepository::class),
            $app->make(PaymentGateway::class),
            $app->make(TransactionManager::class),
            $app->make(Clock::class),
            $app->make(IdGenerator::class),
            array_values((array) config('wallet.topup.packages')),
            (int) config('wallet.topup.ttl_minutes'),
        ));
    }

    private function registerAdapters(): void
    {
        $this->app->singleton(JwksKeyProvider::class, fn (Application $app): JwksKeyProvider => new JwksKeyProvider(
            $app->make('cache.store'),
            $app->make(Factory::class),
            (string) config('wallet.jwt.jwks_url'),
            (int) config('wallet.jwt.jwks_ttl_seconds'),
            (int) config('wallet.jwt.jwks_refresh_min_interval'),
        ));
        $this->app->singleton(JwtVerifier::class, fn (Application $app): JwtVerifier => new JwtVerifier(
            $app->make(JwksKeyProvider::class),
            (string) config('wallet.jwt.issuer'),
            (int) config('wallet.jwt.leeway_seconds'),
        ));
        $this->app->bind(AuthenticateJwt::class, fn (Application $app): AuthenticateJwt => new AuthenticateJwt(
            $app->make(JwtVerifier::class),
            array_values((array) config('wallet.jwt.user_audiences')),
            (string) config('wallet.jwt.internal_audience'),
        ));
        $this->app->bind(TopUpController::class, fn (Application $app): TopUpController => new TopUpController(
            $app->make(CreateTopUpUseCase::class),
            $app->make(GetTopUpUseCase::class),
            $app->make(SimulatePaymentUseCase::class),
            array_values((array) config('wallet.topup.packages')),
        ));
        $this->app->bind(PaymentWebhookController::class, fn (Application $app): PaymentWebhookController => new PaymentWebhookController(
            $app->make(HandlePaymentWebhookUseCase::class),
            $app->make(LoggerInterface::class),
            (string) config('wallet.payment.webhook_secret'),
            (int) config('wallet.payment.webhook_tolerance_seconds'),
        ));
        $this->app->bind(HealthController::class, fn (Application $app): HealthController => new HealthController(
            $app->make(ConnectionInterface::class),
            $app->make(AmqpConnectionFactory::class),
            $app->make(DynamoDbClient::class),
            (string) config('wallet.idempotency.table'),
        ));
        $this->app->bind(AmqpConsumer::class, fn (Application $app): AmqpConsumer => new AmqpConsumer(
            $app->make(AmqpConnectionFactory::class),
            $app->make(Topology::class),
            $app->make(WalletCommandHandler::class),
            $app->make(LoggerInterface::class),
            (string) config('wallet.rabbitmq.commands_queue'),
            (int) config('wallet.rabbitmq.prefetch'),
            (int) config('wallet.rabbitmq.max_retries'),
            (int) config('wallet.chaos.wallet_delay_ms'),
        ));
        $this->app->singleton(OutboxRelay::class, fn (Application $app): OutboxRelay => new OutboxRelay(
            $app->make(ConnectionInterface::class),
            $app->make(AmqpConnectionFactory::class),
            $app->make(LoggerInterface::class),
            (int) config('wallet.outbox.batch_size'),
        ));
    }
}
