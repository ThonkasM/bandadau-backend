<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Out\Persistence;

use Bandada\Wallet\Adapter\Shared\Support\Timestamps;
use Bandada\Wallet\Application\Port\Out\LedgerRepository;
use Bandada\Wallet\Domain\Model\Credits;
use Bandada\Wallet\Domain\Model\EntryContext;
use Bandada\Wallet\Domain\Model\LedgerCursor;
use Bandada\Wallet\Domain\Model\LedgerEntry;
use Bandada\Wallet\Domain\Model\LedgerEntryType;
use Bandada\Wallet\Domain\Model\OperationRef;
use Illuminate\Database\ConnectionInterface;

final readonly class PgLedgerRepository implements LedgerRepository
{
    public function __construct(private ConnectionInterface $db) {}

    public function findByOperationRef(OperationRef $ref): ?LedgerEntry
    {
        $row = $this->db->table('ledger_entries')->where('operation_ref', $ref->value)->first();

        return $row === null ? null : $this->hydrate($row);
    }

    public function page(string $userId, int $limit, ?LedgerCursor $cursor, ?LedgerEntryType $type): array
    {
        $query = $this->db->table('ledger_entries')
            ->where('wallet_user_id', $userId)
            ->where('amount_credits', '>', 0);
        if ($type !== null) {
            $query->where('type', $type->value);
        }
        if ($cursor !== null) {
            $query->whereRaw('(created_at, id) < (?::timestamptz, ?::uuid)', [Timestamps::toDb($cursor->createdAt), $cursor->id]);
        }

        return array_values($query->orderByDesc('created_at')->orderByDesc('id')->limit($limit)->get()
            ->map(fn (object $row): LedgerEntry => $this->hydrate($row))
            ->all());
    }

    private function hydrate(object $row): LedgerEntry
    {
        $r = (array) $row;
        $ref = OperationRef::fromString((string) $r['operation_ref']);

        return new LedgerEntry(
            (string) $r['id'],
            (string) $r['wallet_user_id'],
            LedgerEntryType::from((string) $r['type']),
            Credits::of((int) $r['amount_credits']),
            Credits::of((int) $r['balance_after']),
            $ref,
            new EntryContext(
                $r['saga_id'] === null ? null : (string) $r['saga_id'],
                $r['registration_id'] === null ? null : (string) $r['registration_id'],
                $r['event_id'] === null ? null : (string) $r['event_id'],
                $r['top_up_id'] === null ? null : (string) $r['top_up_id'],
                $r['description'] === null ? null : (string) $r['description'],
            ),
            Timestamps::fromDb((string) $r['created_at']),
        );
    }
}
