<?php

use Bandada\Wallet\Adapter\Out\External\SimulatedPaymentGateway;
use Bandada\Wallet\Application\Port\In\CreateTopUpCommand;
use Bandada\Wallet\Application\Port\In\PaymentNotification;
use Bandada\Wallet\Application\UseCase\CreateTopUpService;
use Bandada\Wallet\Application\UseCase\HandlePaymentWebhookService;
use Bandada\Wallet\Application\UseCase\SimulatePaymentService;
use Bandada\Wallet\Domain\Event\EventContext;
use Bandada\Wallet\Domain\Event\TopUpPaid;
use Bandada\Wallet\Domain\Exception\AmountMismatchException;
use Bandada\Wallet\Domain\Exception\ForbiddenOperationException;
use Bandada\Wallet\Domain\Exception\InvalidTopUpPackageException;
use Bandada\Wallet\Domain\Exception\SimulatorDisabledException;
use Bandada\Wallet\Domain\Exception\TopUpNotFoundException;
use Bandada\Wallet\Domain\Exception\TopUpNotPendingException;
use Bandada\Wallet\Domain\Model\TopUpStatus;
use Tests\Support\FixedClock;
use Tests\Support\InMemoryWorld;
use Tests\Support\SequenceIds;
use Tests\Unit\Application\Support;

const KEY = '0192f3c0-aaaa-7bbb-8ccc-dddddddddddd';

beforeEach(function () {
    $this->clock = new FixedClock;
    $this->world = new InMemoryWorld($this->clock);
    $this->ids = new SequenceIds;
    $this->gateway = new SimulatedPaymentGateway('http://app.test/checkout', true);
    $this->create = new CreateTopUpService($this->world, $this->gateway, $this->world, $this->clock, $this->ids, ['CREDITS_20', 'CREDITS_50', 'CREDITS_100'], 30);
    $this->webhook = new HandlePaymentWebhookService($this->world, $this->world, $this->world, $this->world, $this->clock, $this->ids);
    $this->simulate = new SimulatePaymentService($this->world, $this->gateway, $this->webhook, $this->clock, $this->ids);
    $this->notification = fn (string $topUpId, string $status = 'PAID', string $ref = 'SIM-PAY-1', int $amount = 5000) => new PaymentNotification(
        'evt_1', $ref, $topUpId, $status, $amount, 'BOB', $this->clock->now(),
    );
});

it('creates a PENDING top-up that expires in 30 minutes and returns the checkout url', function () {
    $view = $this->create->handle(new CreateTopUpCommand(Support::USER, 'CREDITS_50', KEY));

    expect($view->topUp->status())->toBe(TopUpStatus::Pending)
        ->and($view->topUp->expiresAt->format('c'))->toBe('2026-10-14T15:30:00+00:00')
        ->and($view->checkoutUrl)->toBe('http://app.test/checkout/'.$view->topUp->id)
        ->and($view->topUp->priceMinor())->toBe(5000);
});

it('double click with the same Idempotency-Key creates a single top-up', function () {
    $a = $this->create->handle(new CreateTopUpCommand(Support::USER, 'CREDITS_50', KEY));
    $b = $this->create->handle(new CreateTopUpCommand(Support::USER, 'CREDITS_50', KEY));

    expect($b->topUp->id)->toBe($a->topUp->id)->and($this->world->topUps)->toHaveCount(1);
});

it('rejects unknown or disabled packages', function (string $package) {
    $this->create->handle(new CreateTopUpCommand(Support::USER, $package, KEY));
})->with(['CREDITS_7', 'credits_50', ''])->throws(InvalidTopUpPackageException::class);

it('credits the wallet once per payment, however many times the webhook repeats', function () {
    $topUp = $this->create->handle(new CreateTopUpCommand(Support::USER, 'CREDITS_50', KEY))->topUp;

    $first = $this->webhook->handle(($this->notification)($topUp->id), EventContext::none());
    $second = $this->webhook->handle(($this->notification)($topUp->id), EventContext::none());
    $third = $this->webhook->handle(($this->notification)($topUp->id, ref: 'SIM-PAY-OTHER'), EventContext::none());

    expect($first->duplicate)->toBeFalse()
        ->and($second->duplicate)->toBeTrue()
        ->and($third->duplicate)->toBeTrue()
        ->and($this->world->balanceOf(Support::USER))->toBe(50)
        ->and($this->world->ledger)->toHaveCount(1)
        ->and($this->world->ledger)->toHaveKey('TOPUP:'.$topUp->id)
        ->and(array_filter($this->world->events(), fn ($e) => $e instanceof TopUpPaid))->toHaveCount(1);
});

it('rejects an amount that does not match the package price', function () {
    $topUp = $this->create->handle(new CreateTopUpCommand(Support::USER, 'CREDITS_50', KEY))->topUp;

    $this->webhook->handle(($this->notification)($topUp->id, amount: 4000), EventContext::none());
})->throws(AmountMismatchException::class);

it('answers 404 for an unknown top-up', function () {
    $this->webhook->handle(($this->notification)('0192a3bd-0000-7000-8000-00000000ffff'), EventContext::none());
})->throws(TopUpNotFoundException::class);

it('marks the top-up FAILED on a rejected payment and credits nothing', function () {
    $topUp = $this->create->handle(new CreateTopUpCommand(Support::USER, 'CREDITS_20', KEY))->topUp;

    $result = $this->webhook->handle(($this->notification)($topUp->id, 'FAILED', amount: 2000), EventContext::none());

    expect($result->topUpStatus)->toBe(TopUpStatus::Failed)->and($this->world->ledger)->toBeEmpty();
});

it('still credits a payment that arrives after the top-up expired', function () {
    $topUp = $this->create->handle(new CreateTopUpCommand(Support::USER, 'CREDITS_50', KEY))->topUp;
    $this->clock->advance('PT31M');
    $this->world->expireDue($this->clock->now());
    expect($topUp->status())->toBe(TopUpStatus::Expired);

    $this->webhook->handle(($this->notification)($topUp->id), EventContext::none());

    expect($topUp->status())->toBe(TopUpStatus::Paid)->and($this->world->balanceOf(Support::USER))->toBe(50);
});

it('simulates a payment through the same use case and is repeatable', function () {
    $topUp = $this->create->handle(new CreateTopUpCommand(Support::USER, 'CREDITS_100', KEY))->topUp;

    $one = $this->simulate->handle(Support::USER, $topUp->id, 'PAID', EventContext::none());
    $two = $this->simulate->handle(Support::USER, $topUp->id, 'PAID', EventContext::none());

    expect($one->status)->toBe(TopUpStatus::Paid)
        ->and($two->status)->toBe(TopUpStatus::Paid)
        ->and($this->world->balanceOf(Support::USER))->toBe(100)
        ->and($one->topUp->gatewayRef())->toStartWith('SIM-PAY-');
});

it('does not simulate when the simulator is disabled, for strangers, or on settled top-ups', function () {
    $topUp = $this->create->handle(new CreateTopUpCommand(Support::USER, 'CREDITS_50', KEY))->topUp;

    $off = new SimulatePaymentService($this->world, new SimulatedPaymentGateway('http://x', false), $this->webhook, $this->clock, $this->ids);
    expect(fn () => $off->handle(Support::USER, $topUp->id, 'PAID', EventContext::none()))->toThrow(SimulatorDisabledException::class)
        ->and(fn () => $this->simulate->handle('0192a3b4-0000-7000-8000-00000000dead', $topUp->id, 'PAID', EventContext::none()))->toThrow(ForbiddenOperationException::class);

    $this->simulate->handle(Support::USER, $topUp->id, 'PAID', EventContext::none());
    expect(fn () => $this->simulate->handle(Support::USER, $topUp->id, 'FAILED', EventContext::none()))->toThrow(TopUpNotPendingException::class);
});
