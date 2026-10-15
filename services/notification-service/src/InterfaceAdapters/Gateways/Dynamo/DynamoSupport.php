<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Gateways\Dynamo;

use Aws\DynamoDb\Exception\DynamoDbException;
use Aws\DynamoDb\Marshaler;
use Bandada\Notification\InterfaceAdapters\Shared\Exception\DependencyUnavailableException;

final class DynamoSupport
{
    /**
     * @param  array<string, mixed>  $raw  marshaled item
     * @return array<string, mixed>
     */
    public static function plain(Marshaler $marshaler, array $raw): array
    {
        $plain = $marshaler->unmarshalItem($raw);

        return is_array($plain) ? $plain : (array) $plain;
    }

    public static function code(DynamoDbException $e): string
    {
        return (string) $e->getAwsErrorCode();
    }

    public static function unavailable(DynamoDbException $e): DependencyUnavailableException
    {
        return new DependencyUnavailableException('DynamoDB failed: '.self::code($e), 0, $e);
    }

    /**
     * Per-item reason codes of a cancelled transaction (index-aligned with the request items).
     *
     * @return list<string>
     */
    public static function cancellationCodes(DynamoDbException $e): array
    {
        $reasons = $e->get('CancellationReasons');
        if (! is_array($reasons)) {
            $body = $e->getResponse() === null ? '' : (string) $e->getResponse()->getBody();
            $decoded = json_decode($body, true);
            $reasons = is_array($decoded) && is_array($decoded['CancellationReasons'] ?? null) ? $decoded['CancellationReasons'] : [];
        }

        return array_map(static fn (mixed $r): string => is_array($r) ? (string) ($r['Code'] ?? 'None') : 'None', array_values($reasons));
    }
}
