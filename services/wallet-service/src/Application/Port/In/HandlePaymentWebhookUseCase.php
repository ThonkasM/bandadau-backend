<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

use Bandada\Wallet\Domain\Event\EventContext;

interface HandlePaymentWebhookUseCase
{
    public function handle(PaymentNotification $notification, EventContext $context): PaymentWebhookResult;
}
