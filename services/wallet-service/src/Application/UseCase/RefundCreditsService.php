<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\UseCase;

use Bandada\Wallet\Application\Port\In\RefundCreditsCommand;
use Bandada\Wallet\Application\Port\In\RefundCreditsResult;
use Bandada\Wallet\Application\Port\In\RefundCreditsUseCase;
use Bandada\Wallet\Application\Port\Out\Clock;
use Bandada\Wallet\Application\Port\Out\EventPublisher;
use Bandada\Wallet\Application\Port\Out\IdGenerator;
use Bandada\Wallet\Application\Port\Out\Inbox;
use Bandada\Wallet\Application\Port\Out\LedgerRepository;
use Bandada\Wallet\Application\Port\Out\TransactionManager;
use Bandada\Wallet\Application\Port\Out\WalletRepository;
use Bandada\Wallet\Domain\Event\CreditsRefunded;
use Bandada\Wallet\Domain\Model\Credits;
use Bandada\Wallet\Domain\Model\EntryContext;
use Bandada\Wallet\Domain\Model\LedgerEntry;
use Bandada\Wallet\Domain\Model\OperationRef;

/**
 * SAGA compensation REFUND_CREDITS (UC-13). Tolerant to "nothing to refund": without a prior debit it
 * records a zero-amount REFUND as a tombstone so that a late debit-credits is rejected (SAGA_ABORTED).
 */
final readonly class RefundCreditsService implements RefundCreditsUseCase
{
    public function __construct(
        private WalletRepository $wallets,
        private LedgerRepository $ledger,
        private EventPublisher $events,
        private Inbox $inbox,
        private TransactionManager $tx,
        private Clock $clock,
        private IdGenerator $ids,
    ) {}

    public function handle(RefundCreditsCommand $c): RefundCreditsResult
    {
        return $this->tx->run(function () use ($c): RefundCreditsResult {
            if (! $this->inbox->markProcessed($c->messageId, DebitCreditsService::CONSUMER)) {
                return RefundCreditsResult::duplicateMessage();
            }

            $now = $this->clock->now();
            $wallet = $this->wallets->lockOrCreate($c->userId);
            $refundRef = OperationRef::refund($c->registrationId);

            $existing = $this->ledger->findByOperationRef($refundRef);
            if ($existing !== null) {
                $this->publish($c, $existing, $wallet->balance()->amount, $now);

                return RefundCreditsResult::replayed($existing->amount->amount);
            }

            $debit = $this->ledger->findByOperationRef(OperationRef::debit($c->registrationId));
            $amount = $debit->amount ?? Credits::zero();
            $entry = $wallet->refund(
                $amount,
                $refundRef,
                $this->ids->next(),
                new EntryContext($c->sagaId, $c->registrationId, $debit?->context->eventId),
                $now,
            );
            $this->wallets->save($wallet);
            $this->publish($c, $entry, $wallet->balance()->amount, $now);

            return $amount->isZero() ? RefundCreditsResult::tombstone() : RefundCreditsResult::refunded($amount->amount);
        });
    }

    private function publish(RefundCreditsCommand $c, LedgerEntry $entry, int $balance, \DateTimeImmutable $now): void
    {
        $this->events->publish(new CreditsRefunded(
            $c->sagaId,
            $c->registrationId,
            $c->idempotencyKey,
            $c->userId,
            $entry->amount->isZero() ? null : $entry->id,
            $entry->amount->amount,
            $balance,
            $now,
        ), $c->context);
    }
}
