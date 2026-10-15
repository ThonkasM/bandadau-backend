<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Http\Problem;

/** Stable error codes of the service and their HTTP status. Texts live in lang/{es,en}/problems.php. */
final class ProblemCatalog
{
    private const array STATUS = [
        'VALIDATION_FAILED' => 400,
        'MALFORMED_REQUEST' => 400,
        'INVALID_CURSOR' => 400,
        'INVALID_RANGE' => 400,
        'INVALID_TOPUP_PACKAGE' => 400,
        'IDEMPOTENCY_KEY_REQUIRED' => 400,
        'IDEMPOTENCY_KEY_INVALID' => 400,
        'UNAUTHORIZED' => 401,
        'INVALID_SIGNATURE' => 401,
        'WEBHOOK_EXPIRED' => 401,
        'FORBIDDEN' => 403,
        'NOT_FOUND' => 404,
        'TOPUP_NOT_FOUND' => 404,
        'WALLET_NOT_FOUND' => 404,
        'METHOD_NOT_ALLOWED' => 405,
        'CONFLICT' => 409,
        'INSUFFICIENT_FUNDS' => 409,
        'IDEMPOTENCY_IN_PROGRESS' => 409,
        'TOPUP_NOT_PENDING' => 409,
        'TOPUP_EXPIRED' => 409,
        'GATEWAY_REF_CONFLICT' => 409,
        'UNSUPPORTED_MEDIA_TYPE' => 415,
        'IDEMPOTENCY_KEY_REUSED' => 422,
        'AMOUNT_MISMATCH' => 422,
        'INVALID_CREDITS' => 422,
        'INVALID_OPERATION_REF' => 422,
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
