<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\UseCase;

use Bandada\Wallet\Application\Port\In\ExpireTopUpsUseCase;
use Bandada\Wallet\Application\Port\Out\Clock;
use Bandada\Wallet\Application\Port\Out\TopUpRepository;

final readonly class ExpireTopUpsService implements ExpireTopUpsUseCase
{
    public function __construct(private TopUpRepository $topUps, private Clock $clock) {}

    public function handle(): int
    {
        return $this->topUps->expireDue($this->clock->now());
    }
}
