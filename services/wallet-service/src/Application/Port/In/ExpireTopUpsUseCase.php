<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

interface ExpireTopUpsUseCase
{
    /** Marks overdue PENDING top-ups as EXPIRED; returns how many were expired. */
    public function handle(): int;
}
