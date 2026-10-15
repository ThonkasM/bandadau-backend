<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Controllers\Http\Problem;

/** Stable error codes of the service and their HTTP status. Texts live in lang/{es,en}/problems.php. */
final class ProblemCatalog
{
    private const array STATUS = [
        'VALIDATION_FAILED' => 400,
        'MALFORMED_REQUEST' => 400,
        'INVALID_CURSOR' => 400,
        'IDEMPOTENCY_KEY_REQUIRED' => 400,
        'IDEMPOTENCY_KEY_INVALID' => 400,
        'UNAUTHORIZED' => 401,
        'FORBIDDEN' => 403,
        'NOT_FOUND' => 404,
        'NOTIFICATION_NOT_FOUND' => 404,
        'METHOD_NOT_ALLOWED' => 405,
        'CONFLICT' => 409,
        'IDEMPOTENCY_IN_PROGRESS' => 409,
        'UNSUPPORTED_MEDIA_TYPE' => 415,
        'IDEMPOTENCY_KEY_REUSED' => 422,
        'TYPE_NOT_MUTABLE' => 422,
        'INVALID_DEVICE_TOKEN' => 400,
        'RATE_LIMITED' => 429,
        'INTERNAL_ERROR' => 500,
        'DEPENDENCY_UNAVAILABLE' => 503,
    ];

    public static function status(string $code): int
    {
        return self::STATUS[$code] ?? 500;
    }

    public static function type(string $code): string
    {
        return 'https://api.bandadau.com/problems/'.strtolower(str_replace('_', '-', $code));
    }
}
