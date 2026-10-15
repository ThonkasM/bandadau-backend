<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Http\Support;

final class LocaleResolver
{
    private const array SUPPORTED = ['es', 'en'];

    /** Picks `es` or `en` from an Accept-Language header honouring q-values; anything else falls back to `es`. */
    public static function resolve(?string $header): string
    {
        if ($header === null || trim($header) === '') {
            return 'es';
        }
        $candidates = [];
        foreach (explode(',', $header) as $position => $part) {
            $pieces = explode(';', trim($part));
            $tag = strtolower(trim($pieces[0]));
            $quality = 1.0;
            foreach (array_slice($pieces, 1) as $param) {
                if (preg_match('/^\s*q\s*=\s*([0-9.]+)\s*$/i', $param, $m) === 1) {
                    $quality = (float) $m[1];
                }
            }
            $candidates[] = [$quality, $position, explode('-', $tag)[0]];
        }
        usort($candidates, static fn (array $a, array $b): int => [$b[0], $a[1]] <=> [$a[0], $b[1]]);
        foreach ($candidates as [$quality, , $language]) {
            if ($quality > 0 && in_array($language, self::SUPPORTED, true)) {
                return $language;
            }
        }

        return 'es';
    }
}
