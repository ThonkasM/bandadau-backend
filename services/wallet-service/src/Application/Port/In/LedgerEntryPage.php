<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

use Bandada\Wallet\Domain\Model\LedgerCursor;
use Bandada\Wallet\Domain\Model\LedgerEntry;

final readonly class LedgerEntryPage
{
    /** @param list<LedgerEntry> $items */
    public function __construct(public array $items, public ?LedgerCursor $next) {}
}
