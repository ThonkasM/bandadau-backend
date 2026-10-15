<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Http\Support;

use Bandada\Wallet\Adapter\In\Http\Problem\ProblemException;
use Bandada\Wallet\Adapter\Shared\Support\Timestamps;
use Bandada\Wallet\Domain\Model\LedgerCursor;
use Throwable;

/** Opaque base64url cursor: {"c": created_at, "i": id}. */
final class LedgerCursorCodec
{
    public static function encode(LedgerCursor $cursor): string
    {
        $json = json_encode(['c' => Timestamps::toDb($cursor->createdAt), 'i' => $cursor->id], JSON_THROW_ON_ERROR);

        return rtrim(strtr(base64_encode($json), '+/', '-_'), '=');
    }

    public static function decode(string $token): LedgerCursor
    {
        try {
            $json = base64_decode(strtr($token, '-_', '+/'), true);
            $data = $json === false ? null : json_decode($json, true, 4, JSON_THROW_ON_ERROR);
            if (! is_array($data) || ! is_string($data['c'] ?? null) || ! is_string($data['i'] ?? null)
                || preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $data['i']) !== 1) {
                throw new ProblemException('INVALID_CURSOR');
            }

            return new LedgerCursor(Timestamps::fromDb($data['c']), $data['i']);
        } catch (ProblemException $e) {
            throw $e;
        } catch (Throwable) {
            throw new ProblemException('INVALID_CURSOR');
        }
    }
}
