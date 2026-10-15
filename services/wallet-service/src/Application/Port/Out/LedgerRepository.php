<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\Out;

use Bandada\Wallet\Domain\Model\LedgerCursor;
use Bandada\Wallet\Domain\Model\LedgerEntry;
use Bandada\Wallet\Domain\Model\LedgerEntryType;
use Bandada\Wallet\Domain\Model\OperationRef;

interface LedgerRepository
{
    public function findByOperationRef(OperationRef $ref): ?LedgerEntry;

    /**
     * Visible entries (tombstones excluded), newest first.
     *
     * @return list<LedgerEntry>
     */
    public function page(string $userId, int $limit, ?LedgerCursor $cursor, ?LedgerEntryType $type): array;
}
