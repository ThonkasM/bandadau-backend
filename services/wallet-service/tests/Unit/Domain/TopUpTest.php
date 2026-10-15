<?php

use Bandada\Wallet\Domain\Model\TopUp;
use Bandada\Wallet\Domain\Model\TopUpPackage;
use Bandada\Wallet\Domain\Model\TopUpStatus;

$now = new DateTimeImmutable('2026-10-14T15:00:00Z');
$make = fn () => TopUp::create('0192a3bd-0000-7000-8000-000000000010', '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b', TopUpPackage::Credits50, null, $now, $now->modify('+30 minutes'));

it('prices packages at 1 credit = 1 BOB in minor units', function () {
    expect(TopUpPackage::Credits20->credits())->toBe(20)
        ->and(TopUpPackage::Credits50->priceMinor())->toBe(5000)
        ->and(TopUpPackage::Credits100->priceMinor())->toBe(10000);
});

it('reads as EXPIRED once the 30 minutes lapse even before the sweeper runs', function () use ($make, $now) {
    $topUp = $make();

    expect($topUp->statusAt($now->modify('+29 minutes')))->toBe(TopUpStatus::Pending)
        ->and($topUp->statusAt($now->modify('+30 minutes')))->toBe(TopUpStatus::Expired);
});

it('accepts a late payment (the money arrived) and ignores late failures', function () use ($make, $now) {
    $late = $make();
    $late->markExpired();
    $late->markPaid('SIM-PAY-1', $now);
    expect($late->status())->toBe(TopUpStatus::Paid);

    $paid = $make();
    $paid->markPaid('SIM-PAY-2', $now);
    $paid->markFailed('SIM-PAY-3');
    expect($paid->status())->toBe(TopUpStatus::Paid)->and($paid->gatewayRef())->toBe('SIM-PAY-2');
});
