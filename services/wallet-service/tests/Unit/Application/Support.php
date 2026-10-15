<?php

declare(strict_types=1);

namespace Tests\Unit\Application;

use Bandada\Wallet\Application\Port\In\DebitCreditsCommand;
use Bandada\Wallet\Application\Port\In\RefundCreditsCommand;
use Bandada\Wallet\Application\UseCase\DebitCreditsService;
use Bandada\Wallet\Application\UseCase\RefundCreditsService;
use Bandada\Wallet\Domain\Event\EventContext;
use Tests\Support\FixedClock;
use Tests\Support\InMemoryWorld;
use Tests\Support\SequenceIds;

final class Support
{
    public const USER = '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b';

    public const REG = '0192a3bf-aaaa-7bbb-8ccc-000000000777';

    public const SAGA = '0192a3be-5a6a-7000-8000-000000000001';

    public static function debitService(InMemoryWorld $w, ?FixedClock $clock = null): DebitCreditsService
    {
        return new DebitCreditsService($w, $w, $w, $w, $w, $clock ?? new FixedClock, new SequenceIds);
    }

    public static function refundService(InMemoryWorld $w, ?FixedClock $clock = null): RefundCreditsService
    {
        return new RefundCreditsService($w, $w, $w, $w, $w, $clock ?? new FixedClock, new SequenceIds);
    }

    public static function debit(string $messageId, int $amount = 50, string $registrationId = self::REG, string $userId = self::USER): DebitCreditsCommand
    {
        return new DebitCreditsCommand(
            $messageId, self::SAGA, $registrationId, self::SAGA.':DEBIT_CREDITS', $userId,
            '0192a3be-1234-7abc-8def-000000000042', $amount, 'Inscripción a «Taller»',
            new EventContext('corr-1', $messageId, self::SAGA, null),
        );
    }

    public static function refund(string $messageId, string $registrationId = self::REG, int $amount = 50): RefundCreditsCommand
    {
        return new RefundCreditsCommand(
            $messageId, self::SAGA, $registrationId, self::SAGA.':REFUND_CREDITS', self::USER,
            $amount, 'SAGA_COMPENSATION', new EventContext('corr-1', $messageId, self::SAGA, null),
        );
    }
}
