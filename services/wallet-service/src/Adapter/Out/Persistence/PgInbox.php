<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Out\Persistence;

use Bandada\Wallet\Application\Port\Out\Inbox;
use Illuminate\Database\ConnectionInterface;

final readonly class PgInbox implements Inbox
{
    public function __construct(private ConnectionInterface $db) {}

    public function markProcessed(string $messageId, string $consumer): bool
    {
        return $this->db->table('processed_messages')->insertOrIgnore([
            'message_id' => $messageId,
            'consumer' => $consumer,
            'processed_at' => gmdate('Y-m-d\TH:i:s\Z'),
        ]) === 1;
    }
}
