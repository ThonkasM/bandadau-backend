<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

use Bandada\Wallet\Domain\Event\EventContext;

final readonly class DebitCreditsCommand
{
    public function __construct(
        public string $messageId,
        public string $sagaId,
        public string $registrationId,
        public string $idempotencyKey,
        public string $userId,
        public string $eventId,
        public int $amountCredits,
        public ?string $description,
        public EventContext $context,
    ) {}
}
