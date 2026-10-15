<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Model;

enum TopUpStatus: string
{
    case Pending = 'PENDING';
    case Paid = 'PAID';
    case Failed = 'FAILED';
    case Expired = 'EXPIRED';
}
