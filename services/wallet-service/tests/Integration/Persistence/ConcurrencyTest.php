<?php

use Illuminate\Support\Facades\DB;
use Symfony\Component\Process\Process;

/**
 * Real parallelism: several PHP processes run the use cases against the same rows at once. The wallet
 * row lock must serialize them so the balance never goes negative and always equals the ledger.
 *
 * @param  list<list<string>>  $jobs
 * @return list<string>
 */
function runWorkers(array $jobs): array
{
    $processes = [];
    foreach ($jobs as $job) {
        $processes[] = $process = new Process([PHP_BINARY, base_path('tests/Support/debit_worker.php'), ...$job], base_path());
        $process->setTimeout(60);
    }
    foreach ($processes as $p) {
        $p->start();
    }
    $out = [];
    foreach ($processes as $p) {
        $p->wait();
        $out[] = trim($p->getOutput()).trim($p->getErrorOutput());
    }

    return $out;
}

it('never lets simultaneous debits overdraw the wallet', function () {
    $user = '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b';
    DB::table('wallets')->insert(['user_id' => $user, 'balance_credits' => 100]);

    $jobs = [];
    foreach (range(1, 6) as $i) {
        $jobs[] = ['debit', $user, sprintf('0192a3bf-aaaa-7bbb-8ccc-%012d', $i), '30'];
    }
    $results = runWorkers($jobs);

    $balance = (int) DB::table('wallets')->value('balance_credits');
    expect($balance)->toBeGreaterThanOrEqual(0)
        ->and($balance)->toBe(10)
        ->and(DB::table('ledger_entries')->where('type', 'DEBIT')->count())->toBe(3)
        ->and(substr_count(implode('|', $results), 'DEBITED:'))->toBe(3)
        ->and(substr_count(implode('|', $results), 'INSUFFICIENT_FUNDS'))->toBe(3)
        ->and((int) DB::table('ledger_entries')->selectRaw("sum(CASE WHEN type='DEBIT' THEN -amount_credits ELSE amount_credits END) AS s")->value('s'))->toBe(-90)
        ->and(DB::table('outbox')->where('routing_key', 'bandada.wallet.credits-debited.v1')->count())->toBe(3)
        ->and(DB::table('outbox')->where('routing_key', 'bandada.wallet.credits-debit-failed.v1')->count())->toBe(3);
});

it('applies one debit when the same operation arrives in parallel under different message ids', function () {
    $user = '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b';
    DB::table('wallets')->insert(['user_id' => $user, 'balance_credits' => 100]);
    $registration = '0192a3bf-aaaa-7bbb-8ccc-000000000999';

    runWorkers(array_fill(0, 5, ['debit', $user, $registration, '40']));

    expect((int) DB::table('wallets')->value('balance_credits'))->toBe(60)
        ->and(DB::table('ledger_entries')->where('operation_ref', 'DEBIT:'.$registration)->count())->toBe(1);
});

it('credits a top-up only once when the same webhook is processed by parallel workers', function () {
    $user = '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b';
    $topUp = '0192a3bd-0000-7000-8000-000000000010';
    DB::table('top_ups')->insert([
        'id' => $topUp, 'user_id' => $user, 'package' => 'CREDITS_50', 'amount_credits' => 50, 'price_minor' => 5000,
        'currency' => 'BOB', 'status' => 'PENDING', 'expires_at' => gmdate('Y-m-d H:i:s', time() + 1800),
    ]);

    runWorkers(array_fill(0, 5, ['topup', $user, $topUp, 'SIM-PAY-1']));

    expect((int) DB::table('wallets')->value('balance_credits'))->toBe(50)
        ->and(DB::table('ledger_entries')->where('type', 'TOPUP')->count())->toBe(1)
        ->and(DB::table('outbox')->where('routing_key', 'bandada.wallet.topup.paid.v1')->count())->toBe(1);
});
