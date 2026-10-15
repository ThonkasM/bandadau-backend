<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Model;

/** Business references attached to a ledger entry. */
final readonly class EntryContext
{
    public function __construct(
        public ?string $sagaId = null,
        public ?string $registrationId = null,
        public ?string $eventId = null,
        public ?string $topUpId = null,
        public ?string $description = null,
    ) {}
}
