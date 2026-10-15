<?php

declare(strict_types=1);

namespace Tests\Support;

use Bandada\Wallet\Application\Port\Out\EventPublisher;
use Bandada\Wallet\Application\Port\Out\Inbox;
use Bandada\Wallet\Application\Port\Out\LedgerRepository;
use Bandada\Wallet\Application\Port\Out\TopUpRepository;
use Bandada\Wallet\Application\Port\Out\TransactionManager;
use Bandada\Wallet\Application\Port\Out\WalletRepository;
use Bandada\Wallet\Domain\Event\DomainEvent;
use Bandada\Wallet\Domain\Event\EventContext;
use Bandada\Wallet\Domain\Exception\DuplicateTopUpException;
use Bandada\Wallet\Domain\Model\Credits;
use Bandada\Wallet\Domain\Model\LedgerCursor;
use Bandada\Wallet\Domain\Model\LedgerEntry;
use Bandada\Wallet\Domain\Model\LedgerEntryType;
use Bandada\Wallet\Domain\Model\OperationRef;
use Bandada\Wallet\Domain\Model\TopUp;
use Bandada\Wallet\Domain\Model\TopUpStatus;
use Bandada\Wallet\Domain\Model\Wallet;
use DateTimeImmutable;

/**
 * In-memory doubles of every outbound port, sharing one state, so use cases can be tested without a database.
 * The "transaction" snapshots the state and restores it when the callback throws (rollback semantics).
 */
final class InMemoryWorld implements EventPublisher, Inbox, LedgerRepository, TopUpRepository, TransactionManager, WalletRepository
{
    /** @var array<string, array{balance:int,version:int,updatedAt:DateTimeImmutable}> */
    public array $wallets = [];

    /** @var array<string, LedgerEntry> keyed by operation ref */
    public array $ledger = [];

    /** @var array<string, TopUp> */
    public array $topUps = [];

    /** @var list<array{event:DomainEvent,context:EventContext}> */
    public array $published = [];

    /** @var array<string, true> */
    public array $inbox = [];

    public bool $failOnPublish = false;

    public function __construct(private readonly FixedClock $clock = new FixedClock) {}

    public function run(callable $work): mixed
    {
        $snapshot = [$this->wallets, $this->ledger, $this->topUps, $this->published, $this->inbox];
        try {
            return $work();
        } catch (\Throwable $e) {
            [$this->wallets, $this->ledger, $this->topUps, $this->published, $this->inbox] = $snapshot;
            throw $e;
        }
    }

    public function seedWallet(string $userId, int $balance): void
    {
        $this->wallets[$userId] = ['balance' => $balance, 'version' => 0, 'updatedAt' => $this->clock->now()];
    }

    public function balanceOf(string $userId): int
    {
        return $this->wallets[$userId]['balance'] ?? 0;
    }

    /** @return list<DomainEvent> */
    public function events(): array
    {
        return array_map(static fn (array $p): DomainEvent => $p['event'], $this->published);
    }

    public function ledgerSum(string $userId): int
    {
        $sum = 0;
        foreach ($this->ledger as $entry) {
            if ($entry->walletUserId === $userId) {
                $sum += $entry->type === LedgerEntryType::Debit ? -$entry->amount->amount : $entry->amount->amount;
            }
        }

        return $sum;
    }

    // WalletRepository
    public function findByUserId(string $userId): ?Wallet
    {
        return isset($this->wallets[$userId]) ? $this->hydrate($userId) : null;
    }

    public function findByUserIdForUpdate(string $userId): ?Wallet
    {
        return $this->findByUserId($userId);
    }

    public function lockOrCreate(string $userId): Wallet
    {
        if (! isset($this->wallets[$userId])) {
            $this->seedWallet($userId, 0);
        }

        return $this->hydrate($userId);
    }

    public function save(Wallet|TopUp $entity): void
    {
        if ($entity instanceof TopUp) {
            $this->topUps[$entity->id] = $entity;

            return;
        }
        $wallet = $entity;
        $this->wallets[$wallet->userId()] = [
            'balance' => $wallet->balance()->amount,
            'version' => $wallet->version() + 1,
            'updatedAt' => $wallet->updatedAt(),
        ];
        foreach ($wallet->pullPendingEntries() as $entry) {
            if (isset($this->ledger[$entry->operationRef->value])) {
                throw new \RuntimeException('unique violation on operation_ref '.$entry->operationRef->value);
            }
            $this->ledger[$entry->operationRef->value] = $entry;
        }
    }

    private function hydrate(string $userId): Wallet
    {
        $w = $this->wallets[$userId];

        return Wallet::reconstitute($userId, Credits::of($w['balance']), $w['version'], $w['updatedAt']);
    }

    // LedgerRepository
    public function findByOperationRef(OperationRef $ref): ?LedgerEntry
    {
        return $this->ledger[$ref->value] ?? null;
    }

    public function page(string $userId, int $limit, ?LedgerCursor $cursor, ?LedgerEntryType $type): array
    {
        $entries = array_values(array_filter(
            $this->ledger,
            static fn (LedgerEntry $e): bool => $e->walletUserId === $userId && ! $e->amount->isZero() && ($type === null || $e->type === $type),
        ));
        usort($entries, static fn (LedgerEntry $a, LedgerEntry $b): int => [$b->createdAt, $b->id] <=> [$a->createdAt, $a->id]);
        if ($cursor !== null) {
            $entries = array_values(array_filter(
                $entries,
                static fn (LedgerEntry $e): bool => [$e->createdAt, $e->id] < [$cursor->createdAt, $cursor->id],
            ));
        }

        return array_slice($entries, 0, $limit);
    }

    // TopUpRepository
    public function add(TopUp $topUp): void
    {
        foreach ($this->topUps as $t) {
            if ($topUp->idempotencyKey !== null && $t->userId === $topUp->userId && $t->idempotencyKey === $topUp->idempotencyKey) {
                throw new DuplicateTopUpException('duplicate');
            }
        }
        $this->topUps[$topUp->id] = $topUp;
    }

    public function find(string $id): ?TopUp
    {
        return $this->topUps[$id] ?? null;
    }

    public function findForUpdate(string $id): ?TopUp
    {
        return $this->find($id);
    }

    public function findByGatewayRef(string $gatewayRef): ?TopUp
    {
        foreach ($this->topUps as $t) {
            if ($t->gatewayRef() === $gatewayRef) {
                return $t;
            }
        }

        return null;
    }

    public function findByUserAndIdempotencyKey(string $userId, string $idempotencyKey): ?TopUp
    {
        foreach ($this->topUps as $t) {
            if ($t->userId === $userId && $t->idempotencyKey === $idempotencyKey) {
                return $t;
            }
        }

        return null;
    }

    public function expireDue(DateTimeImmutable $now): int
    {
        $n = 0;
        foreach ($this->topUps as $t) {
            if ($t->status() === TopUpStatus::Pending && $t->expiresAt <= $now) {
                $t->markExpired();
                $n++;
            }
        }

        return $n;
    }

    // EventPublisher
    public function publish(DomainEvent $event, EventContext $context): void
    {
        if ($this->failOnPublish) {
            throw new \RuntimeException('outbox unavailable');
        }
        $this->published[] = ['event' => $event, 'context' => $context];
    }

    // Inbox
    public function markProcessed(string $messageId, string $consumer): bool
    {
        if (isset($this->inbox[$messageId])) {
            return false;
        }
        $this->inbox[$messageId] = true;

        return true;
    }
}
