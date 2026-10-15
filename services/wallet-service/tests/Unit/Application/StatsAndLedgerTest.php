<?php

use Bandada\Wallet\Application\Port\In\CreditStatsQuery;
use Bandada\Wallet\Application\Port\In\ListLedgerEntriesQuery;
use Bandada\Wallet\Application\Port\Out\LedgerStatsRepository;
use Bandada\Wallet\Application\UseCase\GetCreditStatsService;
use Bandada\Wallet\Application\UseCase\GetMyWalletService;
use Bandada\Wallet\Application\UseCase\ListLedgerEntriesService;
use Bandada\Wallet\Domain\Exception\InvalidStatsRangeException;
use Bandada\Wallet\Domain\Model\LedgerCursor;
use Bandada\Wallet\Domain\Model\StatsGroupBy;
use Tests\Support\FixedClock;
use Tests\Support\InMemoryWorld;
use Tests\Unit\Application\Support;

it('shows a virtual wallet at zero when none exists (lazy creation)', function () {
    $world = new InMemoryWorld;

    $view = (new GetMyWalletService($world, new FixedClock))->handle(Support::USER);

    expect($view->balanceCredits)->toBe(0)->and($world->wallets)->toBeEmpty();
});

it('pages the ledger newest first with a keyset cursor and hides tombstones', function () {
    $clock = new FixedClock;
    $world = new InMemoryWorld($clock);
    $world->seedWallet(Support::USER, 1000);
    foreach (range(1, 5) as $i) {
        $clock->advance('PT1M');
        Support::debitService($world, $clock)->handle(Support::debit("m-$i", 10, sprintf('0192a3bf-aaaa-7bbb-8ccc-%012d', $i)));
    }
    $clock->advance('PT1M');
    Support::refundService($world, $clock)->handle(Support::refund('m-r', '0192a3bf-aaaa-7bbb-8ccc-00000000aaaa'));
    $list = new ListLedgerEntriesService($world);

    $page1 = $list->handle(new ListLedgerEntriesQuery(Support::USER, 2));
    $page2 = $list->handle(new ListLedgerEntriesQuery(Support::USER, 2, new LedgerCursor($page1->next->createdAt, $page1->next->id)));
    $page3 = $list->handle(new ListLedgerEntriesQuery(Support::USER, 2, new LedgerCursor($page2->next->createdAt, $page2->next->id)));

    expect($page1->items)->toHaveCount(2)
        ->and($page1->items[0]->operationRef->value)->toBe('DEBIT:0192a3bf-aaaa-7bbb-8ccc-000000000005')
        ->and($page2->items)->toHaveCount(2)
        ->and($page3->items)->toHaveCount(1)
        ->and($page3->next)->toBeNull();
});

it('builds credit stats with zero-filled daily buckets and the net', function () {
    $repo = new class implements LedgerStatsRepository
    {
        public function aggregate(DateTimeImmutable $fromInclusive, DateTimeImmutable $toExclusive, StatsGroupBy $groupBy): array
        {
            return [
                ['bucket' => '2026-10-07', 'type' => 'TOPUP', 'count' => 2, 'credits' => 300],
                ['bucket' => '2026-10-07', 'type' => 'DEBIT', 'count' => 1, 'credits' => 210],
                ['bucket' => '2026-10-09', 'type' => 'REFUND', 'count' => 1, 'credits' => 15],
            ];
        }

        public function circulatingBefore(DateTimeImmutable $before): int
        {
            return 12480;
        }
    };
    $utc = new DateTimeZone('UTC');

    $stats = (new GetCreditStatsService($repo))->handle(new CreditStatsQuery(new DateTimeImmutable('2026-10-07', $utc), new DateTimeImmutable('2026-10-09', $utc)));

    expect($stats->series)->toHaveCount(3)
        ->and($stats->series[1])->toBe(['date' => '2026-10-08', 'topUpCredits' => 0, 'debitCredits' => 0, 'refundCredits' => 0])
        ->and($stats->totals['topUpCredits'])->toBe(300)
        ->and($stats->totals['netCredits'])->toBe(300 - 210 + 15)
        ->and($stats->totals['circulatingCredits'])->toBe(12480);
});

it('rejects inverted or oversized ranges', function (string $from, string $to) {
    $repo = new class implements LedgerStatsRepository
    {
        public function aggregate(DateTimeImmutable $fromInclusive, DateTimeImmutable $toExclusive, StatsGroupBy $groupBy): array
        {
            throw new LogicException('must not be reached');
        }

        public function circulatingBefore(DateTimeImmutable $before): int
        {
            throw new LogicException('must not be reached');
        }
    };
    $utc = new DateTimeZone('UTC');

    (new GetCreditStatsService($repo))->handle(new CreditStatsQuery(new DateTimeImmutable($from, $utc), new DateTimeImmutable($to, $utc)));
})->with([['2026-10-09', '2026-10-01'], ['2024-01-01', '2026-10-01']])->throws(InvalidStatsRangeException::class);
