<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\In;

final readonly class TopSpenders
{
    /** @param list<array{userId:string,creditsSpent:int,registrations:int}> $items */
    public function __construct(
        public string $from,
        public string $to,
        public array $items,
    ) {}
}
