<?php

use Bandada\Wallet\Domain\Exception\InvalidCreditsException;
use Bandada\Wallet\Domain\Model\Credits;

it('rejects negative amounts', function () {
    Credits::of(-1);
})->throws(InvalidCreditsException::class);

it('adds and subtracts integers', function () {
    expect(Credits::of(20)->plus(Credits::of(30))->amount)->toBe(50)
        ->and(Credits::of(50)->minus(Credits::of(20))->amount)->toBe(30);
});

it('never goes below zero', function () {
    Credits::of(10)->minus(Credits::of(11));
})->throws(InvalidCreditsException::class);

it('guards against integer overflow', function () {
    Credits::of(PHP_INT_MAX)->plus(Credits::of(1));
})->throws(InvalidCreditsException::class);
