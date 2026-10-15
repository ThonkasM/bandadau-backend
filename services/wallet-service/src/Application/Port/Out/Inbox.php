<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\Out;

interface Inbox
{
    /** Returns false when the message id was already processed. Must run in the effect's transaction. */
    public function markProcessed(string $messageId, string $consumer): bool;
}
