<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Shared\Amqp;

use InvalidArgumentException;
use PhpAmqpLib\Connection\AbstractConnection;
use PhpAmqpLib\Connection\AMQPConnectionConfig;
use PhpAmqpLib\Connection\AMQPConnectionFactory as PhpAmqpFactory;

final readonly class AmqpConnectionFactory
{
    public function __construct(private string $url, private int $heartbeat = 30) {}

    public function connect(string $connectionName): AbstractConnection
    {
        $parts = parse_url($this->url);
        if ($parts === false || ! isset($parts['host'])) {
            throw new InvalidArgumentException('RABBITMQ_URL is not a valid amqp:// URL');
        }
        $secure = ($parts['scheme'] ?? 'amqp') === 'amqps';

        $config = new AMQPConnectionConfig;
        $config->setHost($parts['host']);
        $config->setPort($parts['port'] ?? ($secure ? 5671 : 5672));
        $config->setUser(isset($parts['user']) ? urldecode($parts['user']) : 'guest');
        $config->setPassword(isset($parts['pass']) ? urldecode($parts['pass']) : 'guest');
        $path = isset($parts['path']) ? urldecode(ltrim($parts['path'], '/')) : '';
        $config->setVhost($path === '' ? '/' : $path);
        $config->setIsSecure($secure);
        $config->setConnectionTimeout(5.0);
        $config->setReadTimeout($this->heartbeat * 2 + 5);
        $config->setWriteTimeout(10.0);
        $config->setHeartbeat($this->heartbeat);
        $config->setKeepalive(true);
        $config->setConnectionName($connectionName);

        return PhpAmqpFactory::create($config);
    }
}
