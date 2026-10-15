<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

use DateTimeImmutable;

/** Normalized gateway callback (the HTTP adapter has already verified its signature). */
final readonly class PaymentNotification
{
    public function __construct(
        public string $eventId,
        public string $gatewayRef,
        public string $topUpId,
        public string $status,
        public int $amountMinor,
        public string $currency,
        public DateTimeImmutable $occurredAt,
    ) {}
}
