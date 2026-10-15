<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\UseCase;

use Bandada\Wallet\Application\Port\In\LedgerEntryPage;
use Bandada\Wallet\Application\Port\In\ListLedgerEntriesQuery;
use Bandada\Wallet\Application\Port\In\ListLedgerEntriesUseCase;
use Bandada\Wallet\Application\Port\Out\LedgerRepository;
use Bandada\Wallet\Domain\Model\LedgerCursor;

final readonly class ListLedgerEntriesService implements ListLedgerEntriesUseCase
{
    public function __construct(private LedgerRepository $ledger) {}

    public function handle(ListLedgerEntriesQuery $query): LedgerEntryPage
    {
        $rows = $this->ledger->page($query->userId, $query->limit + 1, $query->cursor, $query->type);
        $hasMore = count($rows) > $query->limit;
        $items = array_slice($rows, 0, $query->limit);
        $last = $items === [] ? null : $items[array_key_last($items)];
        $next = $hasMore && $last !== null ? new LedgerCursor($last->createdAt, $last->id) : null;

        return new LedgerEntryPage($items, $next);
    }
}
