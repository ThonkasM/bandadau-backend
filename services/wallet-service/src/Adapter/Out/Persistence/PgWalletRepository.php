<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Out\Persistence;

use Bandada\Wallet\Adapter\Shared\Support\Timestamps;
use Bandada\Wallet\Application\Port\Out\WalletRepository;
use Bandada\Wallet\Domain\Model\Credits;
use Bandada\Wallet\Domain\Model\LedgerEntry;
use Bandada\Wallet\Domain\Model\Wallet;
use Illuminate\Database\ConnectionInterface;
use RuntimeException;

final readonly class PgWalletRepository implements WalletRepository
{
    public function __construct(private ConnectionInterface $db) {}

    public function findByUserId(string $userId): ?Wallet
    {
        $row = $this->db->table('wallets')->where('user_id', $userId)->first();

        return $row === null ? null : $this->hydrate($row);
    }

    public function findByUserIdForUpdate(string $userId): ?Wallet
    {
        $row = $this->db->table('wallets')->where('user_id', $userId)->lockForUpdate()->first();

        return $row === null ? null : $this->hydrate($row);
    }

    public function lockOrCreate(string $userId): Wallet
    {
        $this->db->statement(
            'INSERT INTO wallets (user_id, balance_credits, version, created_at, updated_at) VALUES (?, 0, 0, now(), now()) ON CONFLICT (user_id) DO NOTHING',
            [$userId],
        );

        return $this->findByUserIdForUpdate($userId) ?? throw new RuntimeException('Wallet row vanished after creation');
    }

    public function save(Wallet $wallet): void
    {
        $entries = $wallet->pullPendingEntries();
        $updated = $this->db->table('wallets')
            ->where('user_id', $wallet->userId())
            ->where('version', $wallet->version())
            ->update([
                'balance_credits' => $wallet->balance()->amount,
                'version' => $wallet->version() + 1,
                'updated_at' => Timestamps::toDb($wallet->updatedAt()),
            ]);
        if ($updated !== 1) {
            throw new RuntimeException('Concurrent modification of wallet '.$wallet->userId());
        }
        foreach ($entries as $entry) {
            $this->insertEntry($entry);
        }
    }

    private function insertEntry(LedgerEntry $entry): void
    {
        $this->db->table('ledger_entries')->insert([
            'id' => $entry->id,
            'wallet_user_id' => $entry->walletUserId,
            'type' => $entry->type->value,
            'amount_credits' => $entry->amount->amount,
            'balance_after' => $entry->balanceAfter->amount,
            'operation_ref' => $entry->operationRef->value,
            'saga_id' => $entry->context->sagaId,
            'registration_id' => $entry->context->registrationId,
            'event_id' => $entry->context->eventId,
            'top_up_id' => $entry->context->topUpId,
            'description' => $entry->context->description,
            'created_at' => Timestamps::toDb($entry->createdAt),
        ]);
    }

    private function hydrate(object $row): Wallet
    {
        $r = (array) $row;

        return Wallet::reconstitute(
            (string) $r['user_id'],
            Credits::of((int) $r['balance_credits']),
            (int) $r['version'],
            Timestamps::fromDb((string) $r['updated_at']),
        );
    }
}
