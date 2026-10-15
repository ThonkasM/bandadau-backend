<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Model;

enum StatsGroupBy: string
{
    case Day = 'day';
    case Week = 'week';
    case Month = 'month';
}
