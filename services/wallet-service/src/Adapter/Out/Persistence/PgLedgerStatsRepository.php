<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Out\Persistence;

use Bandada\Wallet\Adapter\Shared\Support\Timestamps;
use Bandada\Wallet\Application\Port\Out\LedgerStatsRepository;
use Bandada\Wallet\Domain\Model\StatsGroupBy;
use DateTimeImmutable;
use Illuminate\Database\ConnectionInterface;

final readonly class PgLedgerStatsRepository implements LedgerStatsRepository
{
    public function __construct(private ConnectionInterface $db) {}

    public function aggregate(DateTimeImmutable $fromInclusive, DateTimeImmutable $toExclusive, StatsGroupBy $groupBy): array
    {
        // $groupBy->value comes from a closed enum, never from user input.
        $rows = $this->db->select(
            "SELECT to_char(date_trunc('{$groupBy->value}', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS bucket,
                    type, count(*) AS cnt, COALESCE(sum(amount_credits), 0) AS credits
               FROM ledger_entries
              WHERE created_at >= ?::timestamptz AND created_at < ?::timestamptz AND amount_credits > 0
              GROUP BY 1, 2",
            [Timestamps::toDb($fromInclusive), Timestamps::toDb($toExclusive)],
        );

        return array_values(array_map(static function (object $row): array {
            $r = (array) $row;

            return [
                'bucket' => (string) $r['bucket'],
                'type' => (string) $r['type'],
                'count' => (int) $r['cnt'],
                'credits' => (int) $r['credits'],
            ];
        }, $rows));
    }

    public function circulatingBefore(DateTimeImmutable $before): int
    {
        $row = $this->db->selectOne(
            "SELECT COALESCE(sum(CASE WHEN type = 'DEBIT' THEN -amount_credits ELSE amount_credits END), 0) AS total
               FROM ledger_entries WHERE created_at < ?::timestamptz",
            [Timestamps::toDb($before)],
        );

        return (int) (((array) $row)['total'] ?? 0);
    }
}
