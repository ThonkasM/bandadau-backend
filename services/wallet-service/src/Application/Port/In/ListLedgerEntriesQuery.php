<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

use Bandada\Wallet\Domain\Model\LedgerCursor;
use Bandada\Wallet\Domain\Model\LedgerEntryType;

final readonly class ListLedgerEntriesQuery
{
    public function __construct(
        public string $userId,
        public int $limit = 20,
        public ?LedgerCursor $cursor = null,
        public ?LedgerEntryType $type = null,
    ) {}
}
