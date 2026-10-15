<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Model;

use Bandada\Wallet\Domain\Exception\InsufficientFundsException;
use Bandada\Wallet\Domain\Exception\InvalidCreditsException;
use DateTimeImmutable;

/**
 * Aggregate root. Invariants: balance >= 0 and balance == sum of the ledger.
 * Every balance change appends exactly one LedgerEntry.
 */
final class Wallet
{
    /** @var list<LedgerEntry> */
    private array $pendingEntries = [];

    private function __construct(
        private readonly string $userId,
        private Credits $balance,
        private readonly int $version,
        private DateTimeImmutable $updatedAt,
    ) {}

    public static function open(string $userId, DateTimeImmutable $now): self
    {
        return new self($userId, Credits::zero(), 0, $now);
    }

    public static function reconstitute(string $userId, Credits $balance, int $version, DateTimeImmutable $updatedAt): self
    {
        return new self($userId, $balance, $version, $updatedAt);
    }

    public function userId(): string
    {
        return $this->userId;
    }

    public function balance(): Credits
    {
        return $this->balance;
    }

    public function version(): int
    {
        return $this->version;
    }

    public function updatedAt(): DateTimeImmutable
    {
        return $this->updatedAt;
    }

    public function credit(Credits $amount, OperationRef $ref, string $entryId, EntryContext $context, DateTimeImmutable $now): LedgerEntry
    {
        if (! $amount->isPositive()) {
            throw new InvalidCreditsException('A top-up must be positive');
        }

        return $this->append(LedgerEntryType::TopUp, $this->balance->plus($amount), $amount, $ref, $entryId, $context, $now);
    }

    public function debit(Credits $amount, OperationRef $ref, string $entryId, EntryContext $context, DateTimeImmutable $now): LedgerEntry
    {
        if (! $amount->isPositive()) {
            throw new InvalidCreditsException('A debit must be positive');
        }
        if ($this->balance->lessThan($amount)) {
            throw new InsufficientFundsException($amount->amount, $this->balance->amount);
        }

        return $this->append(LedgerEntryType::Debit, $this->balance->minus($amount), $amount, $ref, $entryId, $context, $now);
    }

    /** Refunds `amount` credits; a zero amount records the tombstone without moving the balance. */
    public function refund(Credits $amount, OperationRef $ref, string $entryId, EntryContext $context, DateTimeImmutable $now): LedgerEntry
    {
        return $this->append(LedgerEntryType::Refund, $this->balance->plus($amount), $amount, $ref, $entryId, $context, $now);
    }

    /** @return list<LedgerEntry> */
    public function pullPendingEntries(): array
    {
        $entries = $this->pendingEntries;
        $this->pendingEntries = [];

        return $entries;
    }

    private function append(
        LedgerEntryType $type,
        Credits $newBalance,
        Credits $amount,
        OperationRef $ref,
        string $entryId,
        EntryContext $context,
        DateTimeImmutable $now,
    ): LedgerEntry {
        if ($ref->type !== $type) {
            throw new InvalidCreditsException("Operation reference {$ref->value} does not match entry type {$type->value}");
        }
        $this->balance = $newBalance;
        $this->updatedAt = $now;
        $entry = new LedgerEntry($entryId, $this->userId, $type, $amount, $newBalance, $ref, $context, $now);
        $this->pendingEntries[] = $entry;

        return $entry;
    }
}
