<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Shared\Messaging\Exception;

use RuntimeException;

/** A message that can never succeed (malformed, unknown type): goes straight to the DLQ. */
final class InvalidMessageException extends RuntimeException {}
