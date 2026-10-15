<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Model;

use DateTimeImmutable;

/** Keyset position of the ledger listing (created_at DESC, id DESC). */
final readonly class LedgerCursor
{
    public function __construct(public DateTimeImmutable $createdAt, public string $id) {}
}
