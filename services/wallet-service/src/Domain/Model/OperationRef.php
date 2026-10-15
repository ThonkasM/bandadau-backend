<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Model;

use Bandada\Wallet\Domain\Exception\InvalidOperationRefException;

/** Business idempotency key of a ledger entry: TOPUP:<id>, DEBIT:<registrationId>, REFUND:<registrationId>. */
final readonly class OperationRef
{
    private function __construct(public string $value, public LedgerEntryType $type) {}

    public static function debit(string $registrationId): self
    {
        return self::build(LedgerEntryType::Debit, $registrationId);
    }

    public static function refund(string $registrationId): self
    {
        return self::build(LedgerEntryType::Refund, $registrationId);
    }

    public static function topUp(string $topUpId): self
    {
        return self::build(LedgerEntryType::TopUp, $topUpId);
    }

    public static function fromString(string $value): self
    {
        if (preg_match('/^(TOPUP|DEBIT|REFUND):([0-9a-f-]{36})$/', $value, $m) !== 1) {
            throw new InvalidOperationRefException("Invalid operation reference: {$value}");
        }

        return self::build(LedgerEntryType::from($m[1]), $m[2]);
    }

    private static function build(LedgerEntryType $type, string $id): self
    {
        if (preg_match('/^[0-9a-f-]{36}$/', $id) !== 1) {
            throw new InvalidOperationRefException("Invalid identifier for operation reference: {$id}");
        }

        return new self($type->value.':'.$id, $type);
    }

    public function equals(self $other): bool
    {
        return $this->value === $other->value;
    }
}
