<?php

use Bandada\Wallet\Application\Port\In\DebitCreditsResult;
use Bandada\Wallet\Domain\Event\CreditsDebited;
use Bandada\Wallet\Domain\Event\CreditsDebitFailed;
use Tests\Support\InMemoryWorld;
use Tests\Unit\Application\Support;

beforeEach(function () {
    $this->world = new InMemoryWorld;
    $this->service = Support::debitService($this->world);
});

it('debits the wallet, writes the ledger entry and answers credits-debited', function () {
    $this->world->seedWallet(Support::USER, 100);

    $result = $this->service->handle(Support::debit('m-1', 50));

    expect($result->outcome)->toBe(DebitCreditsResult::DEBITED)
        ->and($this->world->balanceOf(Support::USER))->toBe(50)
        ->and($this->world->ledger)->toHaveKey('DEBIT:'.Support::REG)
        ->and($this->world->events()[0])->toBeInstanceOf(CreditsDebited::class)
        ->and($this->world->events()[0]->balanceCredits)->toBe(50)
        ->and($this->world->events()[0]->idempotencyKey)->toBe(Support::SAGA.':DEBIT_CREDITS');
});

it('answers INSUFFICIENT_FUNDS without touching the balance', function () {
    $this->world->seedWallet(Support::USER, 20);

    $result = $this->service->handle(Support::debit('m-1', 50));
    $event = $this->world->events()[0];

    expect($result->reason)->toBe('INSUFFICIENT_FUNDS')
        ->and($this->world->balanceOf(Support::USER))->toBe(20)
        ->and($this->world->ledger)->toBeEmpty()
        ->and($event)->toBeInstanceOf(CreditsDebitFailed::class)
        ->and($event->requiredCredits)->toBe(50)
        ->and($event->balanceCredits)->toBe(20);
});

it('answers WALLET_NOT_FOUND when the user never had a wallet', function () {
    $result = $this->service->handle(Support::debit('m-1', 50));

    expect($result->reason)->toBe('WALLET_NOT_FOUND')
        ->and($this->world->events()[0]->balanceCredits)->toBeNull()
        ->and($this->world->wallets)->toBeEmpty();
});

it('is idempotent per message id (inbox)', function () {
    $this->world->seedWallet(Support::USER, 100);

    $this->service->handle(Support::debit('m-1', 50));
    $second = $this->service->handle(Support::debit('m-1', 50));

    expect($second->outcome)->toBe(DebitCreditsResult::DUPLICATE_MESSAGE)
        ->and($this->world->balanceOf(Support::USER))->toBe(50)
        ->and($this->world->events())->toHaveCount(1);
});

it('re-answers a resent command (new message id, same operation) without debiting twice', function () {
    $this->world->seedWallet(Support::USER, 100);

    $this->service->handle(Support::debit('m-1', 50));
    $resent = $this->service->handle(Support::debit('m-2', 50));

    expect($resent->outcome)->toBe(DebitCreditsResult::REPLAYED)
        ->and($this->world->balanceOf(Support::USER))->toBe(50)
        ->and($this->world->events())->toHaveCount(2)
        ->and($this->world->events()[1])->toBeInstanceOf(CreditsDebited::class)
        ->and($this->world->events()[1]->ledgerEntryId)->toBe($this->world->events()[0]->ledgerEntryId);
});

it('refuses a late debit after the refund tombstone exists (SAGA_ABORTED)', function () {
    $this->world->seedWallet(Support::USER, 100);
    Support::refundService($this->world)->handle(Support::refund('m-r'));

    $late = $this->service->handle(Support::debit('m-late', 50));

    expect($late->reason)->toBe('SAGA_ABORTED')
        ->and($this->world->balanceOf(Support::USER))->toBe(100)
        ->and($this->world->ledger)->not->toHaveKey('DEBIT:'.Support::REG);
});

it('keeps the balance non-negative and equal to the ledger across many debits', function () {
    $this->world->seedWallet(Support::USER, 100);
    $regs = array_map(fn (int $i) => sprintf('0192a3bf-aaaa-7bbb-8ccc-%012d', $i), range(1, 8));

    foreach ($regs as $i => $reg) {
        $this->service->handle(Support::debit("m-$i", 30, $reg));
    }

    expect($this->world->balanceOf(Support::USER))->toBe(10)  // three debits of 30 fit in 100
        ->and(count($this->world->ledger))->toBe(3)
        ->and($this->world->balanceOf(Support::USER))->toBeGreaterThanOrEqual(0);
});

it('rolls back inbox, ledger and outbox when something fails midway', function () {
    $this->world->seedWallet(Support::USER, 100);
    $this->world->failOnPublish = true;

    expect(fn () => $this->service->handle(Support::debit('m-1', 50)))->toThrow(RuntimeException::class)
        ->and($this->world->balanceOf(Support::USER))->toBe(100)
        ->and($this->world->inbox)->toBeEmpty()
        ->and($this->world->ledger)->toBeEmpty();
});
