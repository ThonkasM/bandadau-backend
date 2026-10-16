<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Out\Persistence;

use Bandada\Wallet\Adapter\Shared\Support\Timestamps;
use Bandada\Wallet\Application\Port\Out\TopSpendersRepository;
use DateTimeImmutable;
use Illuminate\Database\ConnectionInterface;

final readonly class PgTopSpendersRepository implements TopSpendersRepository
{
    public function __construct(private ConnectionInterface $db) {}

    public function topSpenders(DateTimeImmutable $fromInclusive, DateTimeImmutable $toExclusive, int $limit): array
    {
        $rows = $this->db->select(
            "SELECT wallet_user_id::text AS user_id,
                    COALESCE(sum(amount_credits) FILTER (WHERE type = 'DEBIT'), 0)
                      - COALESCE(sum(amount_credits) FILTER (WHERE type = 'REFUND'), 0) AS spent,
                    count(*) FILTER (WHERE type = 'DEBIT' AND amount_credits > 0) AS debits
               FROM ledger_entries
              WHERE created_at >= ?::timestamptz AND created_at < ?::timestamptz AND type IN ('DEBIT', 'REFUND')
              GROUP BY wallet_user_id
             HAVING COALESCE(sum(amount_credits) FILTER (WHERE type = 'DEBIT'), 0)
                      - COALESCE(sum(amount_credits) FILTER (WHERE type = 'REFUND'), 0) > 0
              ORDER BY spent DESC, wallet_user_id
              LIMIT ?",
            [Timestamps::toDb($fromInclusive), Timestamps::toDb($toExclusive), $limit],
        );

        return array_values(array_map(static function (object $row): array {
            $r = (array) $row;

            return ['userId' => (string) $r['user_id'], 'creditsSpent' => (int) $r['spent'], 'registrations' => (int) $r['debits']];
        }, $rows));
    }
}
