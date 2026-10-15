<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\UseCase;

use Bandada\Wallet\Application\Port\In\CreditStats;
use Bandada\Wallet\Application\Port\In\CreditStatsQuery;
use Bandada\Wallet\Application\Port\In\GetCreditStatsUseCase;
use Bandada\Wallet\Application\Port\Out\LedgerStatsRepository;
use Bandada\Wallet\Domain\Exception\InvalidStatsRangeException;
use Bandada\Wallet\Domain\Model\StatsGroupBy;
use DateInterval;
use DateTimeImmutable;

final readonly class GetCreditStatsService implements GetCreditStatsUseCase
{
    private const int MAX_RANGE_DAYS = 366;

    public function __construct(private LedgerStatsRepository $stats) {}

    public function handle(CreditStatsQuery $query): CreditStats
    {
        $from = $query->from->setTime(0, 0);
        $to = $query->to->setTime(0, 0);
        if ($to < $from) {
            throw new InvalidStatsRangeException('"to" must not precede "from"');
        }
        if ($from->diff($to)->days > self::MAX_RANGE_DAYS) {
            throw new InvalidStatsRangeException('Range cannot exceed '.self::MAX_RANGE_DAYS.' days');
        }

        $toExclusive = $to->add(new DateInterval('P1D'));
        $rows = $this->stats->aggregate($from, $toExclusive, $query->groupBy);

        $series = [];
        foreach ($this->buckets($from, $to, $query->groupBy) as $bucket) {
            $series[$bucket] = ['date' => $bucket, 'topUpCredits' => 0, 'debitCredits' => 0, 'refundCredits' => 0];
        }
        $totals = ['topUpCount' => 0, 'topUpCredits' => 0, 'debitCount' => 0, 'debitCredits' => 0, 'refundCount' => 0, 'refundCredits' => 0];
        foreach ($rows as $row) {
            $series[$row['bucket']] ??= ['date' => $row['bucket'], 'topUpCredits' => 0, 'debitCredits' => 0, 'refundCredits' => 0];
            [$countKey, $creditKey] = match ($row['type']) {
                'TOPUP' => ['topUpCount', 'topUpCredits'],
                'DEBIT' => ['debitCount', 'debitCredits'],
                default => ['refundCount', 'refundCredits'],
            };
            $series[$row['bucket']][$creditKey] += $row['credits'];
            $totals[$countKey] += $row['count'];
            $totals[$creditKey] += $row['credits'];
        }
        ksort($series);

        return new CreditStats(
            $from->format('Y-m-d'),
            $to->format('Y-m-d'),
            $query->groupBy->value,
            $totals + [
                'netCredits' => $totals['topUpCredits'] - $totals['debitCredits'] + $totals['refundCredits'],
                'circulatingCredits' => $this->stats->circulatingBefore($toExclusive),
            ],
            array_values($series),
        );
    }

    /** @return list<string> bucket start dates (UTC) covering the range */
    private function buckets(DateTimeImmutable $from, DateTimeImmutable $to, StatsGroupBy $groupBy): array
    {
        $cursor = match ($groupBy) {
            StatsGroupBy::Day => $from,
            StatsGroupBy::Week => $from->modify('monday this week'),
            StatsGroupBy::Month => $from->modify('first day of this month'),
        };
        $step = match ($groupBy) {
            StatsGroupBy::Day => 'P1D',
            StatsGroupBy::Week => 'P7D',
            StatsGroupBy::Month => 'P1M',
        };
        $out = [];
        while ($cursor <= $to) {
            $out[] = $cursor->format('Y-m-d');
            $cursor = $cursor->add(new DateInterval($step));
        }

        return $out;
    }
}
