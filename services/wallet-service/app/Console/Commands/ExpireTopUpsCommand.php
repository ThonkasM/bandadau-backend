<?php

namespace App\Console\Commands;

use Bandada\Wallet\Application\Port\In\ExpireTopUpsUseCase;
use Illuminate\Console\Command;

class ExpireTopUpsCommand extends Command
{
    protected $signature = 'wallet:expire-topups';

    protected $description = 'Mark overdue PENDING top-ups as EXPIRED';

    public function handle(ExpireTopUpsUseCase $expire): int
    {
        $this->info('Expired top-ups: '.$expire->handle());

        return self::SUCCESS;
    }
}
