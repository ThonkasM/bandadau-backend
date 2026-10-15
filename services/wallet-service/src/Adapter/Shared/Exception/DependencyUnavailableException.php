<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Shared\Exception;

use RuntimeException;

/** A required dependency (DynamoDB, RabbitMQ, ...) failed; rendered as 503 DEPENDENCY_UNAVAILABLE. */
final class DependencyUnavailableException extends RuntimeException {}
