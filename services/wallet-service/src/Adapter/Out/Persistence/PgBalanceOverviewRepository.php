<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Out\Persistence;

use Bandada\Wallet\Application\Port\Out\BalanceOverviewRepository;
use Illuminate\Database\ConnectionInterface;

final readonly class PgBalanceOverviewRepository implements BalanceOverviewRepository
{
    public function __construct(private ConnectionInterface $db) {}

    public function totals(): array
    {
        $row = (array) $this->db->selectOne(
            'SELECT COALESCE(sum(balance_credits), 0) AS circulating, count(*) FILTER (WHERE balance_credits > 0) AS funded FROM wallets',
        );

        return ['creditsInCirculation' => (int) $row['circulating'], 'walletsWithBalance' => (int) $row['funded']];
    }

    public function topBalances(int $limit): array
    {
        $rows = $this->db->select(
            'SELECT user_id::text AS user_id, balance_credits FROM wallets WHERE balance_credits > 0
              ORDER BY balance_credits DESC, user_id LIMIT ?',
            [$limit],
        );

        return array_values(array_map(static function (object $row): array {
            $r = (array) $row;

            return ['userId' => (string) $r['user_id'], 'balanceCredits' => (int) $r['balance_credits']];
        }, $rows));
    }
}
