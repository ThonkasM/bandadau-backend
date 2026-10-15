<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\UseCase;

use Bandada\Wallet\Application\Port\In\DebitCreditsCommand;
use Bandada\Wallet\Application\Port\In\DebitCreditsResult;
use Bandada\Wallet\Application\Port\In\DebitCreditsUseCase;
use Bandada\Wallet\Application\Port\Out\Clock;
use Bandada\Wallet\Application\Port\Out\EventPublisher;
use Bandada\Wallet\Application\Port\Out\IdGenerator;
use Bandada\Wallet\Application\Port\Out\Inbox;
use Bandada\Wallet\Application\Port\Out\LedgerRepository;
use Bandada\Wallet\Application\Port\Out\TransactionManager;
use Bandada\Wallet\Application\Port\Out\WalletRepository;
use Bandada\Wallet\Domain\Event\CreditsDebited;
use Bandada\Wallet\Domain\Event\CreditsDebitFailed;
use Bandada\Wallet\Domain\Exception\InsufficientFundsException;
use Bandada\Wallet\Domain\Model\Credits;
use Bandada\Wallet\Domain\Model\EntryContext;
use Bandada\Wallet\Domain\Model\OperationRef;

/** SAGA step DEBIT_CREDITS (UC-12). Inbox + ledger + outbox commit in one transaction. */
final readonly class DebitCreditsService implements DebitCreditsUseCase
{
    public const string CONSUMER = 'wallet-service.commands';

    public function __construct(
        private WalletRepository $wallets,
        private LedgerRepository $ledger,
        private EventPublisher $events,
        private Inbox $inbox,
        private TransactionManager $tx,
        private Clock $clock,
        private IdGenerator $ids,
    ) {}

    public function handle(DebitCreditsCommand $c): DebitCreditsResult
    {
        return $this->tx->run(function () use ($c): DebitCreditsResult {
            if (! $this->inbox->markProcessed($c->messageId, self::CONSUMER)) {
                return DebitCreditsResult::duplicateMessage();
            }

            $now = $this->clock->now();
            $debitRef = OperationRef::debit($c->registrationId);
            $wallet = $this->wallets->findByUserIdForUpdate($c->userId);

            // Re-sent command (new message id, same operation): answer again with the original result.
            $existing = $this->ledger->findByOperationRef($debitRef);
            if ($existing !== null) {
                $this->events->publish(new CreditsDebited(
                    $c->sagaId, $c->registrationId, $c->idempotencyKey, $c->userId, $existing->id,
                    $existing->amount->amount, $existing->balanceAfter->amount, $now,
                ), $c->context);

                return DebitCreditsResult::replayed();
            }

            // A refund tombstone means the SAGA was already compensated: never debit late.
            if ($this->ledger->findByOperationRef(OperationRef::refund($c->registrationId)) !== null) {
                return $this->fail($c, CreditsDebitFailed::SAGA_ABORTED, $wallet?->balance()->amount, $now);
            }

            if ($wallet === null) {
                return $this->fail($c, CreditsDebitFailed::WALLET_NOT_FOUND, null, $now);
            }

            try {
                $entry = $wallet->debit(
                    Credits::of($c->amountCredits),
                    $debitRef,
                    $this->ids->next(),
                    new EntryContext($c->sagaId, $c->registrationId, $c->eventId, null, $c->description),
                    $now,
                );
            } catch (InsufficientFundsException $e) {
                return $this->fail($c, CreditsDebitFailed::INSUFFICIENT_FUNDS, $e->balanceCredits, $now);
            }

            $this->wallets->save($wallet);
            $this->events->publish(new CreditsDebited(
                $c->sagaId, $c->registrationId, $c->idempotencyKey, $c->userId, $entry->id,
                $entry->amount->amount, $wallet->balance()->amount, $now,
            ), $c->context);

            return DebitCreditsResult::debited();
        });
    }

    private function fail(DebitCreditsCommand $c, string $reason, ?int $balance, \DateTimeImmutable $now): DebitCreditsResult
    {
        $this->events->publish(new CreditsDebitFailed(
            $c->sagaId, $c->registrationId, $c->idempotencyKey, $c->userId, $reason, max(1, $c->amountCredits), $balance, $now,
        ), $c->context);

        return DebitCreditsResult::failed($reason);
    }
}
