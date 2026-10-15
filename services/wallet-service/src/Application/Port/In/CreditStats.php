<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

final readonly class CreditStats
{
    /**
     * @param  array{topUpCount:int,topUpCredits:int,debitCount:int,debitCredits:int,refundCount:int,refundCredits:int,netCredits:int,circulatingCredits:int}  $totals
     * @param  list<array{date:string,topUpCredits:int,debitCredits:int,refundCredits:int}>  $series
     */
    public function __construct(
        public string $from,
        public string $to,
        public string $groupBy,
        public array $totals,
        public array $series,
    ) {}
}
