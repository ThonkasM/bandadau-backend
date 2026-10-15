<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

interface ListLedgerEntriesUseCase
{
    public function handle(ListLedgerEntriesQuery $query): LedgerEntryPage;
}
