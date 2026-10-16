<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\ApiHelpers;
use Tests\Support\TestJwt;

uses(ApiHelpers::class);

function serviceHeaders(string $scope = 'internal:read'): array
{
    return ['Authorization' => 'Bearer '.TestJwt::serviceToken($scope)];
}

it('requires a service token for /internal/v1/stats/credits', function () {
    $this->getJson('/internal/v1/stats/credits?from=2026-10-01&to=2026-10-07')->assertStatus(401);
    $this->getJson('/internal/v1/stats/credits?from=2026-10-01&to=2026-10-07', $this->auth())->assertStatus(403)->assertJsonPath('code', 'FORBIDDEN');
    $this->getJson('/internal/v1/stats/credits?from=2026-10-01&to=2026-10-07', serviceHeaders('mcp:tools'))->assertStatus(403);
});

it('aggregates top-ups per day and reports circulating credits', function () {
    foreach (['CREDITS_20', 'CREDITS_100'] as $package) {
        $id = $this->createTopUp($package)->json('topUpId');
        $this->postJson("/api/v1/wallet/topups/{$id}/simulate-payment", [], $this->auth())->assertOk();
    }
    $today = gmdate('Y-m-d');

    $response = $this->getJson("/internal/v1/stats/credits?from={$today}&to={$today}&groupBy=day", serviceHeaders());

    $response->assertOk()
        ->assertJsonPath('from', $today)->assertJsonPath('groupBy', 'day')
        ->assertJsonPath('totals.topUpCount', 2)->assertJsonPath('totals.topUpCredits', 120)
        ->assertJsonPath('totals.debitCount', 0)->assertJsonPath('totals.netCredits', 120)
        ->assertJsonPath('totals.circulatingCredits', 120)
        ->assertJsonPath('series.0.date', $today)->assertJsonPath('series.0.topUpCredits', 120);
});

it('validates the query', function (string $query) {
    $this->getJson("/internal/v1/stats/credits?{$query}", serviceHeaders())->assertStatus(400);
})->with(['', 'from=2026-10-01', 'from=nope&to=2026-10-01', 'from=2026-10-09&to=2026-10-01', 'from=2026-10-01&to=2026-10-02&groupBy=year']);

it('ranks top spenders by net credits (debits minus refunds) and requires internal:read', function () {
    $now = gmdate('Y-m-d H:i:sO');
    $ana = '0192a3bf-aaaa-7bbb-8ccc-0000000000a1';
    $bob = '0192a3bf-aaaa-7bbb-8ccc-0000000000b2';
    $eva = '0192a3bf-aaaa-7bbb-8ccc-0000000000e3';
    foreach ([$ana, $bob, $eva] as $u) {
        DB::table('wallets')->insert(['user_id' => $u, 'balance_credits' => 1000]);
    }
    $entry = static fn (string $user, string $type, int $amount, string $ref): array => [
        'id' => (string) Str::uuid(), 'wallet_user_id' => $user, 'type' => $type, 'amount_credits' => $amount,
        'balance_after' => 1000, 'operation_ref' => $ref, 'created_at' => $now,
    ];
    DB::table('ledger_entries')->insert([
        $entry($ana, 'DEBIT', 25, 'DEBIT:t-1'), $entry($ana, 'DEBIT', 20, 'DEBIT:t-2'),
        $entry($bob, 'DEBIT', 30, 'DEBIT:t-3'), $entry($bob, 'REFUND', 30, 'REFUND:t-3'),
        $entry($eva, 'DEBIT', 10, 'DEBIT:t-4'), $entry($eva, 'TOPUP', 100, 'TOPUP:t-5'),
    ]);
    $today = gmdate('Y-m-d');

    $this->getJson("/internal/v1/stats/top-spenders?from={$today}&to={$today}&limit=5", serviceHeaders())
        ->assertOk()
        ->assertJsonCount(2, 'items')
        ->assertJsonPath('items.0', ['userId' => $ana, 'creditsSpent' => 45, 'registrations' => 2])
        ->assertJsonPath('items.1', ['userId' => $eva, 'creditsSpent' => 10, 'registrations' => 1]);
    $this->getJson("/internal/v1/stats/top-spenders?from={$today}&to={$today}&limit=1", serviceHeaders())->assertOk()->assertJsonCount(1, 'items');
    $this->getJson("/internal/v1/stats/top-spenders?from={$today}&to={$today}", [])->assertStatus(401);
    $this->getJson("/internal/v1/stats/top-spenders?from={$today}&to={$today}", serviceHeaders('mcp:tools'))->assertStatus(403);
    foreach (['', "from={$today}", "from={$today}&to={$today}&limit=21", "from={$today}&to={$today}&limit=0", 'from=2026-10-09&to=2026-10-01'] as $query) {
        $this->getJson("/internal/v1/stats/top-spenders?{$query}", serviceHeaders())->assertStatus(400);
    }
});

it('summarizes current balances and requires internal:read', function () {
    $ids = ['0192a3bf-aaaa-7bbb-8ccc-0000000000c1', '0192a3bf-aaaa-7bbb-8ccc-0000000000c2', '0192a3bf-aaaa-7bbb-8ccc-0000000000c3',
        '0192a3bf-aaaa-7bbb-8ccc-0000000000c4', '0192a3bf-aaaa-7bbb-8ccc-0000000000c5'];
    foreach (array_combine($ids, [100, 100, 7, 0, 3]) as $user => $balance) {
        DB::table('wallets')->insert(['user_id' => $user, 'balance_credits' => $balance]);
    }

    $this->getJson('/internal/v1/stats/balances', serviceHeaders())
        ->assertOk()
        ->assertJsonPath('creditsInCirculation', 210)
        ->assertJsonPath('walletsWithBalance', 4)
        ->assertJsonPath('averageBalance', 52.5)
        ->assertJsonCount(4, 'items')
        ->assertJsonPath('items.0', ['userId' => $ids[0], 'balanceCredits' => 100])
        ->assertJsonPath('items.1', ['userId' => $ids[1], 'balanceCredits' => 100])
        ->assertJsonPath('items.2', ['userId' => $ids[2], 'balanceCredits' => 7]);
    $this->getJson('/internal/v1/stats/balances?limit=1', serviceHeaders())->assertOk()->assertJsonCount(1, 'items')
        ->assertJsonPath('creditsInCirculation', 210);
    $this->getJson('/internal/v1/stats/balances', [])->assertStatus(401);
    $this->getJson('/internal/v1/stats/balances', $this->auth())->assertStatus(403);
    $this->getJson('/internal/v1/stats/balances', serviceHeaders('mcp:tools'))->assertStatus(403);
    foreach (['limit=0', 'limit=21', 'limit=abc'] as $query) {
        $this->getJson("/internal/v1/stats/balances?{$query}", serviceHeaders())->assertStatus(400);
    }
});

it('reports zeros when no wallet has balance', function () {
    $this->getJson('/internal/v1/stats/balances', serviceHeaders())->assertOk()
        ->assertJsonPath('creditsInCirculation', 0)->assertJsonPath('walletsWithBalance', 0)
        ->assertJsonPath('averageBalance', 0)->assertJsonCount(0, 'items');
});
