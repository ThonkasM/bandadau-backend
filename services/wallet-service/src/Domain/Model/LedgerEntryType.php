<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Model;

enum LedgerEntryType: string
{
    case TopUp = 'TOPUP';
    case Debit = 'DEBIT';
    case Refund = 'REFUND';
}
