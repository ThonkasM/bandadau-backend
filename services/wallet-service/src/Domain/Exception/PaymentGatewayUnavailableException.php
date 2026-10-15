<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Exception;

/** The payment gateway does not answer (UC-15 5a); the caller may retry with the same Idempotency-Key. */
final class PaymentGatewayUnavailableException extends DomainException
{
    public function __construct()
    {
        parent::__construct('Payment gateway is unavailable');
    }

    public function errorCode(): string
    {
        return 'PAYMENT_GATEWAY_UNAVAILABLE';
    }
}
