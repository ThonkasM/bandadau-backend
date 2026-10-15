<?php

declare(strict_types=1);

namespace Tests\Support;

use Illuminate\Support\Facades\Http;

final class Mailpit
{
    public static function base(): string
    {
        return 'http://mailpit:8025/api/v1';
    }

    public static function clear(): void
    {
        Http::delete(self::base().'/messages');
    }

    /** @return list<array<string, mixed>> */
    public static function messages(): array
    {
        return Http::get(self::base().'/messages')->json('messages') ?? [];
    }

    /** @return array<string, mixed> */
    public static function message(string $id): array
    {
        return Http::get(self::base().'/message/'.$id)->json();
    }
}
