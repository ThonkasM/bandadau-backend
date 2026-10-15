<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Out\Persistence;

use Bandada\Wallet\Application\Port\Out\TransactionManager;
use Illuminate\Database\ConnectionInterface;

final readonly class PostgresTransactionManager implements TransactionManager
{
    public function __construct(private ConnectionInterface $db) {}

    public function run(callable $work): mixed
    {
        return $this->db->transaction(static fn () => $work());
    }
}
