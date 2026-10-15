<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Exception;

final class GatewayRefConflictException extends DomainException
{
    public function __construct(public readonly string $gatewayRef)
    {
        parent::__construct("Gateway reference {$gatewayRef} already belongs to another top-up");
    }

    public function errorCode(): string
    {
        return 'GATEWAY_REF_CONFLICT';
    }
}
