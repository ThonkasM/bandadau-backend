<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Minishlink\WebPush\VAPID;

class VapidKeysCommand extends Command
{
    protected $signature = 'bandada:vapid-keys';

    protected $description = 'Generate a VAPID key pair for Web Push (put it in VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY; never commit it)';

    public function handle(): int
    {
        $keys = VAPID::createVapidKeys();
        $this->line('VAPID_PUBLIC_KEY='.$keys['publicKey']);
        $this->line('VAPID_PRIVATE_KEY='.$keys['privateKey']);

        return self::SUCCESS;
    }
}
