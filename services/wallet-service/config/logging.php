<?php

use App\Logging\JsonLogFormatter;
use App\Logging\LogContextProcessor;
use Monolog\Handler\NullHandler;
use Monolog\Handler\StreamHandler;

return [
    'default' => env('LOG_CHANNEL', 'stdout'),

    'deprecations' => [
        'channel' => 'null',
        'trace' => false,
    ],

    'channels' => [
        'stdout' => [
            'driver' => 'monolog',
            'level' => env('LOG_LEVEL', 'info'),
            'handler' => StreamHandler::class,
            'with' => ['stream' => 'php://stdout'],
            'formatter' => JsonLogFormatter::class,
            'processors' => [LogContextProcessor::class],
        ],
        'stderr' => [
            'driver' => 'monolog',
            'level' => env('LOG_LEVEL', 'info'),
            'handler' => StreamHandler::class,
            'with' => ['stream' => 'php://stderr'],
            'formatter' => JsonLogFormatter::class,
            'processors' => [LogContextProcessor::class],
        ],
        'null' => [
            'driver' => 'monolog',
            'handler' => NullHandler::class,
        ],
    ],
];
