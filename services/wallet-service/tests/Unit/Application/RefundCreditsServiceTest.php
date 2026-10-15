<?php

use Bandada\Wallet\Application\Port\In\RefundCreditsResult;
use Bandada\Wallet\Domain\Event\CreditsRefunded;
use Tests\Support\InMemoryWorld;
use Tests\Unit\Application\Support;

beforeEach(function () {
    $this->world = new InMemoryWorld;
    $this->world->seedWallet(Support::USER, 100);
});

it('refunds exactly what was debited', function () {
    Support::debitService($this->world)->handle(Support::debit('m-1', 30));

    $result = Support::refundService($this->world)->handle(Support::refund('m-2', amount: 999));
    $event = $this->world->events()[1];

    expect($result->outcome)->toBe(RefundCreditsResult::REFUNDED)
        ->and($result->refundedCredits)->toBe(30)
        ->and($this->world->balanceOf(Support::USER))->toBe(100)
        ->and($event)->toBeInstanceOf(CreditsRefunded::class)
        ->and($event->amountCredits)->toBe(30)
        ->and($event->ledgerEntryId)->not->toBeNull();
});

it('records a zero-amount tombstone when there was no debit', function () {
    $result = Support::refundService($this->world)->handle(Support::refund('m-1'));
    $event = $this->world->events()[0];

    expect($result->outcome)->toBe(RefundCreditsResult::TOMBSTONE)
        ->and($this->world->ledger)->toHaveKey('REFUND:'.Support::REG)
        ->and($this->world->balanceOf(Support::USER))->toBe(100)
        ->and($event->amountCredits)->toBe(0)
        ->and($event->ledgerEntryId)->toBeNull();
});

it('creates the wallet at zero for a tombstone when the user never had one', function () {
    $world = new InMemoryWorld;

    Support::refundService($world)->handle(Support::refund('m-1'));

    expect($world->wallets)->toHaveKey(Support::USER)->and($world->balanceOf(Support::USER))->toBe(0);
});

it('is idempotent: a resent refund answers again and does not refund twice', function () {
    Support::debitService($this->world)->handle(Support::debit('m-1', 30));
    $service = Support::refundService($this->world);

    $service->handle(Support::refund('m-2'));
    $dupMessage = $service->handle(Support::refund('m-2'));
    $resent = $service->handle(Support::refund('m-3'));

    expect($dupMessage->outcome)->toBe(RefundCreditsResult::DUPLICATE_MESSAGE)
        ->and($resent->outcome)->toBe(RefundCreditsResult::REPLAYED)
        ->and($resent->refundedCredits)->toBe(30)
        ->and($this->world->balanceOf(Support::USER))->toBe(100)
        ->and($this->world->ledgerSum(Support::USER))->toBe(0)
        ->and(array_map(fn ($e) => $e::class, $this->world->events()))->toHaveCount(3);
});
