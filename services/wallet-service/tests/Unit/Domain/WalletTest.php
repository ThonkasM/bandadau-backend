<?php

use Bandada\Wallet\Domain\Exception\InsufficientFundsException;
use Bandada\Wallet\Domain\Exception\InvalidCreditsException;
use Bandada\Wallet\Domain\Model\Credits;
use Bandada\Wallet\Domain\Model\EntryContext;
use Bandada\Wallet\Domain\Model\LedgerEntryType;
use Bandada\Wallet\Domain\Model\OperationRef;
use Bandada\Wallet\Domain\Model\Wallet;

$now = new DateTimeImmutable('2026-10-14T15:00:00Z');
$user = '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b';
$reg = '0192a3bf-aaaa-7bbb-8ccc-000000000777';
$id = '0192a3c0-1111-7aaa-8bbb-000000000001';

it('debits and records one ledger entry with the balance after', function () use ($now, $user, $reg, $id) {
    $wallet = Wallet::reconstitute($user, Credits::of(100), 3, $now);
    $entry = $wallet->debit(Credits::of(15), OperationRef::debit($reg), $id, new EntryContext(registrationId: $reg), $now);

    expect($wallet->balance()->amount)->toBe(85)
        ->and($entry->balanceAfter->amount)->toBe(85)
        ->and($entry->type)->toBe(LedgerEntryType::Debit)
        ->and($wallet->pullPendingEntries())->toHaveCount(1)
        ->and($wallet->pullPendingEntries())->toBeEmpty();
});

it('refuses to overdraw and leaves the balance untouched', function () use ($now, $user, $reg, $id) {
    $wallet = Wallet::reconstitute($user, Credits::of(10), 0, $now);

    try {
        $wallet->debit(Credits::of(11), OperationRef::debit($reg), $id, new EntryContext, $now);
    } catch (InsufficientFundsException $e) {
        expect($e->errorCode())->toBe('INSUFFICIENT_FUNDS')->and($e->requiredCredits)->toBe(11)->and($e->balanceCredits)->toBe(10);
    }

    expect($wallet->balance()->amount)->toBe(10)->and($wallet->pullPendingEntries())->toBeEmpty();
});

it('credits a top-up and refunds a debit', function () use ($now, $user, $reg, $id) {
    $wallet = Wallet::open($user, $now);
    $wallet->credit(Credits::of(50), OperationRef::topUp($reg), $id, new EntryContext(topUpId: $reg), $now);
    $wallet->refund(Credits::of(20), OperationRef::refund($reg), '0192a3c0-1111-7aaa-8bbb-000000000002', new EntryContext, $now);

    expect($wallet->balance()->amount)->toBe(70);
});

it('records a zero refund as a tombstone without moving the balance', function () use ($now, $user, $reg, $id) {
    $wallet = Wallet::reconstitute($user, Credits::of(40), 0, $now);
    $entry = $wallet->refund(Credits::zero(), OperationRef::refund($reg), $id, new EntryContext, $now);

    expect($entry->isTombstone())->toBeTrue()->and($wallet->balance()->amount)->toBe(40);
});

it('does not accept a debit/credit of zero or a mismatching reference', function (string $kind) use ($now, $user, $reg, $id) {
    $wallet = Wallet::reconstitute($user, Credits::of(40), 0, $now);
    match ($kind) {
        'zero-debit' => $wallet->debit(Credits::zero(), OperationRef::debit($reg), $id, new EntryContext, $now),
        'zero-credit' => $wallet->credit(Credits::zero(), OperationRef::topUp($reg), $id, new EntryContext, $now),
        'wrong-ref' => $wallet->debit(Credits::of(1), OperationRef::refund($reg), $id, new EntryContext, $now),
    };
})->with(['zero-debit', 'zero-credit', 'wrong-ref'])->throws(InvalidCreditsException::class);
