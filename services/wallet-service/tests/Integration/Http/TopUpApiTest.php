<?php

use Bandada\Wallet\Adapter\Shared\Idempotency\IdempotencyOutcome;
use Bandada\Wallet\Adapter\Shared\Idempotency\IdempotencyStore;
use Bandada\Wallet\Application\Port\Out\PaymentGateway;
use Illuminate\Support\Facades\DB;
use Tests\Support\ApiHelpers;

uses(ApiHelpers::class);

it('shows a virtual wallet at zero without creating a row', function () {
    $this->getJson('/api/v1/wallet/me', $this->auth())
        ->assertOk()
        ->assertJsonPath('userId', self::USER)
        ->assertJsonPath('balanceCredits', 0)
        ->assertJsonStructure(['userId', 'balanceCredits', 'updatedAt']);
    expect(DB::table('wallets')->count())->toBe(0);
});

it('creates a top-up (201) with checkout url, 30 minute expiry and Location', function () {
    $response = $this->createTopUp('CREDITS_50');

    $response->assertCreated()
        ->assertJsonPath('package', 'CREDITS_50')
        ->assertJsonPath('amountCredits', 50)
        ->assertJsonPath('priceMinor', 5000)
        ->assertJsonPath('currency', 'BOB')
        ->assertJsonPath('status', 'PENDING')
        ->assertHeader('Idempotent-Replayed', 'false');
    $id = $response->json('topUpId');
    expect($response->json('checkoutUrl'))->toBe('http://app.bandada.localhost/wallet/checkout/'.$id)
        ->and($response->headers->get('Location'))->toBe('/api/v1/wallet/topups/'.$id)
        ->and(strtotime($response->json('expiresAt')) - time())->toBeBetween(1790, 1801);
});

it('treats a double click (same Idempotency-Key) as ONE charge and replays the response', function () {
    $key = $this->newKey();

    $first = $this->createTopUp('CREDITS_50', $key);
    $second = $this->createTopUp('CREDITS_50', $key);

    $second->assertCreated()->assertHeader('Idempotent-Replayed', 'true')->assertJson($first->json());
    expect(DB::table('top_ups')->count())->toBe(1);
});

it('rejects the same key with another body (422) and a key still in progress (409)', function () {
    $key = $this->newKey();
    $this->createTopUp('CREDITS_50', $key)->assertCreated();

    $this->createTopUp('CREDITS_100', $key)->assertStatus(422)->assertJsonPath('code', 'IDEMPOTENCY_KEY_REUSED');

    // someone else's key
    $this->createTopUp('CREDITS_50', $key, self::OTHER_USER)->assertStatus(422)->assertJsonPath('code', 'IDEMPOTENCY_KEY_REUSED');

    // A request still in flight: capture the exact hash the middleware computes, then leave the key IN_PROGRESS.
    $store = app(IdempotencyStore::class);
    $captured = new class($store) implements IdempotencyStore
    {
        public ?string $hash = null;

        public function __construct(private IdempotencyStore $inner) {}

        public function reserve(string $key, string $requestHash, string $principal): IdempotencyOutcome
        {
            $this->hash = $requestHash;

            return $this->inner->reserve($key, $requestHash, $principal);
        }

        public function complete(string $key, int $status, array $headers, string $body): void {}

        public function release(string $key): void {}
    };
    app()->instance(IdempotencyStore::class, $captured);
    $inFlight = $this->newKey();
    $this->createTopUp('CREDITS_50', $inFlight)->assertCreated();   // complete() is a no-op: the key stays IN_PROGRESS

    $this->createTopUp('CREDITS_50', $inFlight)->assertStatus(409)->assertHeader('Retry-After', '1')->assertJsonPath('code', 'IDEMPOTENCY_IN_PROGRESS');
});

it('requires a valid Idempotency-Key and a valid package', function () {
    $this->postJson('/api/v1/wallet/topups', ['package' => 'CREDITS_50'], $this->auth())->assertStatus(400)->assertJsonPath('code', 'IDEMPOTENCY_KEY_REQUIRED');
    $this->postJson('/api/v1/wallet/topups', ['package' => 'CREDITS_50'], $this->auth() + ['Idempotency-Key' => 'nope'])->assertStatus(400)->assertJsonPath('code', 'IDEMPOTENCY_KEY_INVALID');

    $this->createTopUp('CREDITS_7')->assertStatus(400)
        ->assertJsonPath('code', 'VALIDATION_FAILED')
        ->assertJsonPath('errors.0.field', 'package')
        ->assertJsonPath('errors.0.code', 'INVALID_VALUE');
    $this->postJson('/api/v1/wallet/topups', [], $this->auth() + ['Idempotency-Key' => $this->newKey()])
        ->assertStatus(400)->assertJsonPath('errors.0.code', 'REQUIRED');
    $this->call('POST', '/api/v1/wallet/topups', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json', 'HTTP_AUTHORIZATION' => $this->auth()['Authorization'], 'HTTP_IDEMPOTENCY_KEY' => $this->newKey()], '{broken')
        ->assertStatus(400)->assertJsonPath('code', 'MALFORMED_REQUEST');
});

it('simulate-payment credits the wallet and publishes topup.paid through the outbox', function () {
    $topUpId = $this->createTopUp('CREDITS_50')->json('topUpId');

    $paid = $this->postJson("/api/v1/wallet/topups/{$topUpId}/simulate-payment", [], $this->auth());

    $paid->assertOk()->assertJsonPath('status', 'PAID')->assertJsonPath('id', $topUpId);
    expect($paid->json('gatewayRef'))->toStartWith('SIM-PAY-');

    $this->getJson('/api/v1/wallet/me', $this->auth())->assertOk()->assertJsonPath('balanceCredits', 50);
    $this->getJson("/api/v1/wallet/topups/{$topUpId}", $this->auth())->assertOk()->assertJsonPath('status', 'PAID');

    $entries = $this->getJson('/api/v1/wallet/me/entries', $this->auth());
    $entries->assertOk()->assertJsonPath('items.0.type', 'TOPUP')
        ->assertJsonPath('items.0.amountCredits', 50)
        ->assertJsonPath('items.0.balanceAfterCredits', 50)
        ->assertJsonPath('items.0.operationRef', "TOPUP:{$topUpId}")
        ->assertJsonPath('items.0.topUpId', $topUpId)
        ->assertJsonPath('items.0.description', 'Recarga de 50 créditos')
        ->assertJsonPath('nextCursor', null);

    $outbox = DB::table('outbox')->get();
    expect($outbox)->toHaveCount(1)->and($outbox[0]->routing_key)->toBe('bandada.wallet.topup.paid.v1');
    $event = json_decode($outbox[0]->payload, true);
    expect($event['specversion'])->toBe('1.0')
        ->and($event['source'])->toBe('/services/wallet-service')
        ->and($event['data'])->toMatchArray(['topUpId' => $topUpId, 'userId' => self::USER, 'package' => 'CREDITS_50', 'amountCredits' => 50, 'balanceCredits' => 50])
        ->and($event['traceparent'])->toMatch('/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/')
        ->and($event)->toHaveKey('correlationid');

    // repeating the simulated payment is a no-op
    $this->postJson("/api/v1/wallet/topups/{$topUpId}/simulate-payment", [], $this->auth())->assertOk()->assertJsonPath('status', 'PAID');
    expect(DB::table('ledger_entries')->count())->toBe(1)->and(DB::table('outbox')->count())->toBe(1);
});

it('simulate-payment with outcome FAILED fails the top-up without crediting', function () {
    $topUpId = $this->createTopUp('CREDITS_20')->json('topUpId');

    $this->postJson("/api/v1/wallet/topups/{$topUpId}/simulate-payment", ['outcome' => 'FAILED'], $this->auth())->assertOk()->assertJsonPath('status', 'FAILED');
    $this->postJson("/api/v1/wallet/topups/{$topUpId}/simulate-payment", ['outcome' => 'PAID'], $this->auth())->assertStatus(409)->assertJsonPath('code', 'TOPUP_NOT_PENDING');
    $this->postJson("/api/v1/wallet/topups/{$topUpId}/simulate-payment", ['outcome' => 'MAYBE'], $this->auth())->assertStatus(400);
    $this->postJson("/api/v1/wallet/topups/{$topUpId}/simulate-payment", ['outcome' => 'FAILED', 'x' => 1], $this->auth())->assertStatus(400);
    expect(DB::table('ledger_entries')->count())->toBe(0);
});

it('answers 404 for simulate-payment when the simulator is disabled', function () {
    $topUpId = $this->createTopUp()->json('topUpId');
    config(['wallet.payment.simulator_enabled' => false]);
    app()->forgetInstance(PaymentGateway::class);

    $this->postJson("/api/v1/wallet/topups/{$topUpId}/simulate-payment", [], $this->auth())->assertStatus(404)->assertJsonPath('code', 'NOT_FOUND');
    expect(DB::table('top_ups')->where('id', $topUpId)->value('status'))->toBe('PENDING');
});

it('keeps top-ups private: strangers get 403, unknown ids 404, malformed ids 400', function () {
    $topUpId = $this->createTopUp()->json('topUpId');

    $this->getJson("/api/v1/wallet/topups/{$topUpId}", $this->auth(self::OTHER_USER))->assertStatus(403)->assertJsonPath('code', 'FORBIDDEN');
    $this->postJson("/api/v1/wallet/topups/{$topUpId}/simulate-payment", [], $this->auth(self::OTHER_USER))->assertStatus(403);
    $this->getJson('/api/v1/wallet/topups/0192a3bd-0000-7000-8000-00000000ffff', $this->auth())->assertStatus(404)->assertJsonPath('code', 'TOPUP_NOT_FOUND');
    $this->getJson('/api/v1/wallet/topups/not-a-uuid', $this->auth())->assertStatus(400);
});

it('shows an overdue pending top-up as EXPIRED and the sweeper persists it', function () {
    $topUpId = $this->createTopUp()->json('topUpId');
    DB::table('top_ups')->where('id', $topUpId)->update(['expires_at' => gmdate('Y-m-d H:i:s', time() - 60)]);

    $this->getJson("/api/v1/wallet/topups/{$topUpId}", $this->auth())->assertOk()->assertJsonPath('status', 'EXPIRED');
    expect(DB::table('top_ups')->where('id', $topUpId)->value('status'))->toBe('PENDING');

    $this->artisan('wallet:expire-topups')->assertSuccessful();
    expect(DB::table('top_ups')->where('id', $topUpId)->value('status'))->toBe('EXPIRED');
    $this->postJson("/api/v1/wallet/topups/{$topUpId}/simulate-payment", [], $this->auth())->assertStatus(409)->assertJsonPath('code', 'TOPUP_EXPIRED');
});

it('lists ledger entries newest first with a cursor, a type filter and localized descriptions', function () {
    foreach (['CREDITS_20', 'CREDITS_50', 'CREDITS_100'] as $package) {
        $id = $this->createTopUp($package)->json('topUpId');
        $this->postJson("/api/v1/wallet/topups/{$id}/simulate-payment", [], $this->auth())->assertOk();
        usleep(2000);
    }

    $page1 = $this->getJson('/api/v1/wallet/me/entries?limit=2', $this->auth() + ['Accept-Language' => 'en']);
    $page1->assertOk()->assertJsonCount(2, 'items')->assertJsonPath('items.0.amountCredits', 100)->assertJsonPath('items.0.description', 'Top-up of 100 credits');
    expect($page1->json('nextCursor'))->toBeString();

    $page2 = $this->getJson('/api/v1/wallet/me/entries?limit=2&cursor='.$page1->json('nextCursor'), $this->auth());
    $page2->assertOk()->assertJsonCount(1, 'items')->assertJsonPath('items.0.amountCredits', 20)->assertJsonPath('nextCursor', null);

    $this->getJson('/api/v1/wallet/me/entries?type=DEBIT', $this->auth())->assertOk()->assertJsonCount(0, 'items');
    $this->getJson('/api/v1/wallet/me/entries?cursor=garbage', $this->auth())->assertStatus(400)->assertJsonPath('code', 'INVALID_CURSOR');
    $this->getJson('/api/v1/wallet/me/entries?limit=51', $this->auth())->assertStatus(400)->assertJsonPath('code', 'VALIDATION_FAILED');
    $this->getJson('/api/v1/wallet/me/entries?type=GIFT', $this->auth())->assertStatus(400);
});
