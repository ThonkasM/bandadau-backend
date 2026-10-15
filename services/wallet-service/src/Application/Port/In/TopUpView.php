<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

use Bandada\Wallet\Domain\Model\TopUp;
use Bandada\Wallet\Domain\Model\TopUpStatus;

/** A top-up with its status as observed now (a lapsed PENDING reads as EXPIRED) and, on creation, the checkout URL. */
final readonly class TopUpView
{
    public function __construct(
        public TopUp $topUp,
        public TopUpStatus $status,
        public ?string $checkoutUrl = null,
    ) {}
}
