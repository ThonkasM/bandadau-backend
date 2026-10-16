<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\Out;

use DateTimeImmutable;

interface TopSpendersRepository
{
    /**
     * Users ranked by net credits spent (DEBIT minus REFUND) in the range, only those above zero.
     *
     * @return list<array{userId:string,creditsSpent:int,registrations:int}>
     */
    public function topSpenders(DateTimeImmutable $fromInclusive, DateTimeImmutable $toExclusive, int $limit): array;
}
