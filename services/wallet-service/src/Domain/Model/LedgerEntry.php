<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Model;

use DateTimeImmutable;

final readonly class LedgerEntry
{
    public function __construct(
        public string $id,
        public string $walletUserId,
        public LedgerEntryType $type,
        public Credits $amount,
        public Credits $balanceAfter,
        public OperationRef $operationRef,
        public EntryContext $context,
        public DateTimeImmutable $createdAt,
    ) {}

    /** A zero-amount REFUND is the tombstone recorded when a refund arrives without a prior debit. */
    public function isTombstone(): bool
    {
        return $this->type === LedgerEntryType::Refund && $this->amount->isZero();
    }
}
