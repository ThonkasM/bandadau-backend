<?php

namespace App\Providers;

use App\Support\EnvironmentValidator;
use Aws\DynamoDb\DynamoDbClient;
use Aws\DynamoDb\Marshaler;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\HealthController;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Middleware\AuthenticateJwt;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Middleware\RequestContext;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Security\JwksKeyProvider;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Security\JwtVerifier;
use Bandada\Notification\InterfaceAdapters\Controllers\Messaging\AmqpConsumer;
use Bandada\Notification\InterfaceAdapters\Controllers\Messaging\DomainEventDispatcher;
use Bandada\Notification\InterfaceAdapters\Controllers\Messaging\MessageHandler;
use Bandada\Notification\InterfaceAdapters\Gateways\Dynamo\DynamoDeviceRepository;
use Bandada\Notification\InterfaceAdapters\Gateways\Dynamo\DynamoIdempotencyStore;
use Bandada\Notification\InterfaceAdapters\Gateways\Dynamo\DynamoNotificationRepository;
use Bandada\Notification\InterfaceAdapters\Gateways\Dynamo\DynamoPreferenceRepository;
use Bandada\Notification\InterfaceAdapters\Gateways\Dynamo\DynamoTables;
use Bandada\Notification\InterfaceAdapters\Gateways\Expo\ExpoPushSender;
use Bandada\Notification\InterfaceAdapters\Gateways\Smtp\SmtpEmailSender;
use Bandada\Notification\InterfaceAdapters\Gateways\System\SystemClock;
use Bandada\Notification\InterfaceAdapters\Gateways\System\UuidV7Generator;
use Bandada\Notification\InterfaceAdapters\Gateways\Templates\IcuTemplateRenderer;
use Bandada\Notification\InterfaceAdapters\Shared\Amqp\AmqpConnectionFactory;
use Bandada\Notification\InterfaceAdapters\Shared\Amqp\Topology;
use Bandada\Notification\InterfaceAdapters\Shared\Idempotency\IdempotencyStore;
use Bandada\Notification\UseCases\Notify\EventToNotificationMapper;
use Bandada\Notification\UseCases\Notify\NotificationSettings;
use Bandada\Notification\UseCases\Ports\Clock;
use Bandada\Notification\UseCases\Ports\DeviceRepository;
use Bandada\Notification\UseCases\Ports\EmailSender;
use Bandada\Notification\UseCases\Ports\IdGenerator;
use Bandada\Notification\UseCases\Ports\NotificationRepository;
use Bandada\Notification\UseCases\Ports\PreferenceRepository;
use Bandada\Notification\UseCases\Ports\PushSender;
use Bandada\Notification\UseCases\Ports\TemplateRenderer;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\ServiceProvider;
use Psr\Log\LoggerInterface;

/** Composition root: binds ports to adapters and builds the interactors. */
class NotificationServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(RequestContext::class);
        $this->app->singleton(AmqpConnectionFactory::class, fn (): AmqpConnectionFactory => new AmqpConnectionFactory((string) config('notification.rabbitmq.url')));
        $this->app->singleton(DynamoDbClient::class, function (): DynamoDbClient {
            $c = config('notification.dynamodb');
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
            (string) config('notification.rabbitmq.queue'),
            (string) config('notification.rabbitmq.events_exchange'),
            array_values((array) config('notification.rabbitmq.bindings')),
            (string) config('notification.rabbitmq.events_exchange'),
            (string) config('notification.rabbitmq.commands_exchange'),
            (string) config('notification.rabbitmq.dlx'),
        ));
        $this->app->singleton(DynamoTables::class, fn (Application $app): DynamoTables => new DynamoTables(
            $app->make(DynamoDbClient::class),
            (string) config('notification.table'),
            (string) config('notification.idempotency.table'),
            (bool) config('notification.dynamodb.auto_create_tables'),
        ));

        $this->registerPorts();
        $this->registerAdapters();
    }

    public function boot(): void
    {
        if (! $this->app->runningInConsole() && ! $this->app->runningUnitTests()) {
            EnvironmentValidator::assertValid();
        }
    }

    private function registerPorts(): void
    {
        $this->app->singleton(Clock::class, SystemClock::class);
        $this->app->singleton(IdGenerator::class, UuidV7Generator::class);
        $table = fn (): string => (string) config('notification.table');
        $this->app->bind(NotificationRepository::class, fn (Application $a): NotificationRepository => new DynamoNotificationRepository($a->make(DynamoDbClient::class), new Marshaler, $table()));
        $this->app->bind(PreferenceRepository::class, fn (Application $a): PreferenceRepository => new DynamoPreferenceRepository($a->make(DynamoDbClient::class), new Marshaler, $table()));
        $this->app->bind(DeviceRepository::class, fn (Application $a): DeviceRepository => new DynamoDeviceRepository($a->make(DynamoDbClient::class), new Marshaler, $table()));
        $this->app->singleton(TemplateRenderer::class, fn (): TemplateRenderer => new IcuTemplateRenderer((string) config('notification.display_timezone')));
        $this->app->bind(EmailSender::class, fn (Application $a): EmailSender => new SmtpEmailSender($a->make('mailer')));
        $this->app->bind(PushSender::class, fn (Application $a): PushSender => new ExpoPushSender(
            $a->make(Factory::class),
            (string) config('notification.push.url'),
            (string) config('notification.push.access_token'),
            (int) config('notification.push.chunk_size'),
        ));
        $this->app->singleton(NotificationSettings::class, fn (): NotificationSettings => new NotificationSettings(
            (bool) config('notification.push.enabled'),
            (bool) config('notification.email.enabled'),
            (int) config('notification.ttl_days'),
            (int) config('notification.inbox_ttl_days'),
            (int) config('notification.dedupe_ttl_days'),
            (int) config('notification.reaction_group_minutes') * 60,
            (string) config('notification.deep_link_base'),
            array_values((array) config('notification.email.backoff_ms')),
        ));
        $this->app->bind(EventToNotificationMapper::class, fn (): EventToNotificationMapper => new EventToNotificationMapper((string) config('notification.deep_link_base')));
        $this->app->singleton(IdempotencyStore::class, fn (Application $a): IdempotencyStore => new DynamoIdempotencyStore(
            $a->make(DynamoDbClient::class), new Marshaler,
            (string) config('notification.idempotency.table'), (string) config('notification.service'),
            (int) config('notification.idempotency.ttl_seconds'), (int) config('notification.idempotency.lock_seconds'),
        ));
    }

    private function registerAdapters(): void
    {
        $this->app->singleton(JwksKeyProvider::class, fn (Application $a): JwksKeyProvider => new JwksKeyProvider(
            $a->make('cache.store'), $a->make(Factory::class),
            (string) config('notification.jwt.jwks_url'), (int) config('notification.jwt.jwks_ttl_seconds'), (int) config('notification.jwt.jwks_refresh_min_interval'),
        ));
        $this->app->singleton(JwtVerifier::class, fn (Application $a): JwtVerifier => new JwtVerifier(
            $a->make(JwksKeyProvider::class), (string) config('notification.jwt.issuer'), (int) config('notification.jwt.leeway_seconds'),
        ));
        $this->app->bind(AuthenticateJwt::class, fn (Application $a): AuthenticateJwt => new AuthenticateJwt(
            $a->make(JwtVerifier::class), array_values((array) config('notification.jwt.user_audiences')), (string) config('notification.jwt.internal_audience'),
        ));
        $this->app->bind(HealthController::class, fn (Application $a): HealthController => new HealthController($a->make(AmqpConnectionFactory::class), $a->make(DynamoTables::class)));
        $this->app->bind(MessageHandler::class, DomainEventDispatcher::class);
        $this->app->bind(AmqpConsumer::class, fn (Application $a): AmqpConsumer => new AmqpConsumer(
            $a->make(AmqpConnectionFactory::class), $a->make(Topology::class), $a->make(MessageHandler::class),
            $a->make(LoggerInterface::class), (string) config('notification.rabbitmq.queue'),
            (int) config('notification.rabbitmq.prefetch'), (int) config('notification.rabbitmq.max_retries'),
        ));
    }
}
