<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\Out;

use Bandada\Wallet\Domain\Model\Wallet;

interface WalletRepository
{
    public function findByUserId(string $userId): ?Wallet;

    /** Row lock (SELECT ... FOR UPDATE); must be called inside a transaction. */
    public function findByUserIdForUpdate(string $userId): ?Wallet;

    /** Creates the wallet at zero when missing, then returns it locked for update. */
    public function lockOrCreate(string $userId): Wallet;

    /** Persists balance, bumps the version and appends the wallet's pending ledger entries. */
    public function save(Wallet $wallet): void;
}
