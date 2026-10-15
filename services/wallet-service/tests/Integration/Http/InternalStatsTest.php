<?php

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
