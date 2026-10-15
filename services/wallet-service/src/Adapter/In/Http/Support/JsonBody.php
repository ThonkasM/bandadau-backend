<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Http\Support;

use Bandada\Wallet\Adapter\In\Http\Problem\ProblemException;
use JsonException;

final class JsonBody
{
    /** @return array<string, mixed> */
    public static function parse(string $raw, bool $allowEmpty = false): array
    {
        if (trim($raw) === '') {
            if ($allowEmpty) {
                return [];
            }
            throw new ProblemException('MALFORMED_REQUEST');
        }
        try {
            $decoded = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new ProblemException('MALFORMED_REQUEST');
        }
        if (! is_array($decoded) || ($decoded !== [] && array_is_list($decoded))) {
            throw new ProblemException('MALFORMED_REQUEST');
        }

        return $decoded;
    }
}
