<?php

use Illuminate\Support\Facades\DB;
use Tests\Support\ApiHelpers;

uses(ApiHelpers::class);

beforeEach(function () {
    $this->topUpId = $this->createTopUp('CREDITS_50')->json('topUpId');
});

it('credits once and answers 200 with duplicate=true when the gateway repeats the callback', function () {
    $payload = $this->paymentPayload($this->topUpId);

    $first = $this->webhook($payload);
    $again = $this->webhook($payload);
    $third = $this->webhook($payload);

    $first->assertOk()->assertExactJson(['received' => true, 'duplicate' => false, 'topUpStatus' => 'PAID']);
    foreach ([$again, $third] as $repeat) {
        $repeat->assertOk()->assertExactJson(['received' => true, 'duplicate' => true, 'topUpStatus' => 'PAID']);
    }
    expect(DB::table('ledger_entries')->count())->toBe(1)
        ->and(DB::table('wallets')->value('balance_credits'))->toBe(50)
        ->and(DB::table('outbox')->where('routing_key', 'bandada.wallet.topup.paid.v1')->count())->toBe(1)
        ->and(DB::table('top_ups')->where('id', $this->topUpId)->value('gateway_ref'))->toBe('SIM-PAY-8f3a2c19');
});

it('rejects missing, malformed or wrong signatures with 401 and no effect', function (?string $signature) {
    $payload = $this->paymentPayload($this->topUpId);
    $raw = json_encode($payload);

    $this->webhook($payload, rawOverride: $raw, signatureOverride: $signature ?? '')->assertStatus(401)->assertJsonPath('code', 'INVALID_SIGNATURE');
    expect(DB::table('ledger_entries')->count())->toBe(0);
})->with([null, 'sha256=abc', 'sha256='.str_repeat('0', 64), 'md5=whatever']);

it('rejects a body signed with another secret or tampered after signing', function () {
    $payload = $this->paymentPayload($this->topUpId);

    $this->webhook($payload, secret: 'another-secret-0123456789')->assertStatus(401);

    $raw = json_encode($payload);
    $signature = 'sha256='.hash_hmac('sha256', $raw, config('wallet.payment.webhook_secret'));
    $tampered = str_replace('5000', '1', $raw);
    $this->webhook($payload, rawOverride: $tampered, signatureOverride: $signature)->assertStatus(401);
});

it('enforces the 5 minute anti-replay window', function () {
    $old = $this->paymentPayload($this->topUpId, occurredAt: gmdate('Y-m-d\TH:i:s\Z', time() - 301));
    $future = $this->paymentPayload($this->topUpId, occurredAt: gmdate('Y-m-d\TH:i:s\Z', time() + 301));
    $edge = $this->paymentPayload($this->topUpId, occurredAt: gmdate('Y-m-d\TH:i:s\Z', time() - 280));

    $this->webhook($old)->assertStatus(401)->assertJsonPath('code', 'WEBHOOK_EXPIRED');
    $this->webhook($future)->assertStatus(401)->assertJsonPath('code', 'WEBHOOK_EXPIRED');
    $this->webhook($edge)->assertOk();
});

it('validates the payload and the amount', function () {
    $this->webhook(['foo' => 'bar'])->assertStatus(400)->assertJsonPath('code', 'VALIDATION_FAILED');
    $this->webhook($this->paymentPayload($this->topUpId, amountMinor: 4999))->assertStatus(422)->assertJsonPath('code', 'AMOUNT_MISMATCH');
    $this->webhook($this->paymentPayload('0192a3bd-0000-7000-8000-00000000ffff'))->assertStatus(404)->assertJsonPath('code', 'TOPUP_NOT_FOUND');
    $this->webhook($this->paymentPayload($this->topUpId, status: 'REFUNDED'))->assertStatus(400);
    expect(DB::table('ledger_entries')->count())->toBe(0);
});

it('marks the top-up FAILED on a rejected payment', function () {
    $this->webhook($this->paymentPayload($this->topUpId, status: 'FAILED'))->assertOk()->assertJsonPath('topUpStatus', 'FAILED');
    $this->webhook($this->paymentPayload($this->topUpId, status: 'FAILED'))->assertOk()->assertJsonPath('duplicate', true);
    expect(DB::table('ledger_entries')->count())->toBe(0);
});

it('does not let one gateway reference settle two top-ups', function () {
    $other = $this->createTopUp('CREDITS_50')->json('topUpId');
    $this->webhook($this->paymentPayload($this->topUpId))->assertOk();

    $this->webhook($this->paymentPayload($other))->assertStatus(409)->assertJsonPath('code', 'GATEWAY_REF_CONFLICT');
    expect(DB::table('ledger_entries')->count())->toBe(1);
});

it('keeps the webhook outside JWT authentication', function () {
    $this->webhook($this->paymentPayload($this->topUpId))->assertOk();   // no Authorization header at all
});
