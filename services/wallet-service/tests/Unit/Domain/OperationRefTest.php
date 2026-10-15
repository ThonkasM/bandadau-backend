<?php

use Bandada\Wallet\Domain\Exception\InvalidOperationRefException;
use Bandada\Wallet\Domain\Model\LedgerEntryType;
use Bandada\Wallet\Domain\Model\OperationRef;

const REG_ID = '0192a3bf-aaaa-7bbb-8ccc-000000000777';

it('builds the three reference kinds', function () {
    expect(OperationRef::debit(REG_ID)->value)->toBe('DEBIT:'.REG_ID)
        ->and(OperationRef::refund(REG_ID)->value)->toBe('REFUND:'.REG_ID)
        ->and(OperationRef::topUp(REG_ID)->value)->toBe('TOPUP:'.REG_ID)
        ->and(OperationRef::fromString('DEBIT:'.REG_ID)->type)->toBe(LedgerEntryType::Debit);
});

it('rejects malformed references', function (string $value) {
    OperationRef::fromString($value);
})->with(['DEBIT:123', 'FOO:'.REG_ID, REG_ID])->throws(InvalidOperationRefException::class);
