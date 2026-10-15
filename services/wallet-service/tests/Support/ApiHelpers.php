<?php

declare(strict_types=1);

namespace Tests\Support;

use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

trait ApiHelpers
{
    public const USER = '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b';

    public const OTHER_USER = '0192a3b4-0000-7000-8000-00000000beef';

    /** @return array<string, string> */
    protected function auth(string $userId = self::USER): array
    {
        return ['Authorization' => 'Bearer '.TestJwt::userToken($userId)];
    }

    protected function newKey(): string
    {
        return Str::uuid7()->toString();
    }

    protected function createTopUp(string $package = 'CREDITS_50', ?string $key = null, string $userId = self::USER): TestResponse
    {
        return $this->postJson('/api/v1/wallet/topups', ['package' => $package], $this->auth($userId) + ['Idempotency-Key' => $key ?? $this->newKey()]);
    }

    /** @param array<string, mixed> $payload */
    protected function webhook(array $payload, ?string $secret = null, ?string $rawOverride = null, ?string $signatureOverride = null): TestResponse
    {
        $raw = $rawOverride ?? json_encode($payload, JSON_UNESCAPED_SLASHES);
        $signature = $signatureOverride ?? 'sha256='.hash_hmac('sha256', $raw, $secret ?? (string) config('wallet.payment.webhook_secret'));

        return $this->call('POST', '/api/v1/wallet/webhooks/payment', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_X_SIGNATURE' => $signature,
        ], $raw);
    }

    /** @return array<string, mixed> */
    protected function paymentPayload(string $topUpId, string $status = 'PAID', string $gatewayRef = 'SIM-PAY-8f3a2c19', int $amountMinor = 5000, ?string $occurredAt = null): array
    {
        return [
            'eventId' => 'evt_01JA7K3M2Q8XN4R6T9V0W1Y2Z3',
            'gatewayRef' => $gatewayRef,
            'topUpId' => $topUpId,
            'status' => $status,
            'amountMinor' => $amountMinor,
            'currency' => 'BOB',
            'occurredAt' => $occurredAt ?? gmdate('Y-m-d\TH:i:s\Z'),
        ];
    }
}
