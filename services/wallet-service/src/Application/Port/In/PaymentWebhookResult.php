<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

use Bandada\Wallet\Domain\Model\TopUp;
use Bandada\Wallet\Domain\Model\TopUpStatus;

final readonly class PaymentWebhookResult
{
    public function __construct(public bool $duplicate, public TopUpStatus $topUpStatus, public TopUp $topUp) {}
}
