<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\UseCase;

use Bandada\Wallet\Application\Port\In\HandlePaymentWebhookUseCase;
use Bandada\Wallet\Application\Port\In\PaymentNotification;
use Bandada\Wallet\Application\Port\In\PaymentWebhookResult;
use Bandada\Wallet\Application\Port\Out\Clock;
use Bandada\Wallet\Application\Port\Out\EventPublisher;
use Bandada\Wallet\Application\Port\Out\IdGenerator;
use Bandada\Wallet\Application\Port\Out\TopUpRepository;
use Bandada\Wallet\Application\Port\Out\TransactionManager;
use Bandada\Wallet\Application\Port\Out\WalletRepository;
use Bandada\Wallet\Domain\Event\EventContext;
use Bandada\Wallet\Domain\Event\TopUpPaid;
use Bandada\Wallet\Domain\Exception\AmountMismatchException;
use Bandada\Wallet\Domain\Exception\GatewayRefConflictException;
use Bandada\Wallet\Domain\Exception\TopUpNotFoundException;
use Bandada\Wallet\Domain\Model\Credits;
use Bandada\Wallet\Domain\Model\EntryContext;
use Bandada\Wallet\Domain\Model\OperationRef;
use Bandada\Wallet\Domain\Model\TopUp;
use Bandada\Wallet\Domain\Model\TopUpStatus;

/**
 * Applies a gateway callback. Idempotent per gatewayRef: the top-up row is locked, an already
 * paid top-up is a duplicate, and the ledger's unique operationRef is the safety net.
 */
final readonly class HandlePaymentWebhookService implements HandlePaymentWebhookUseCase
{
    public function __construct(
        private TopUpRepository $topUps,
        private WalletRepository $wallets,
        private EventPublisher $events,
        private TransactionManager $tx,
        private Clock $clock,
        private IdGenerator $ids,
    ) {}

    public function handle(PaymentNotification $notification, EventContext $context): PaymentWebhookResult
    {
        return $this->tx->run(function () use ($notification, $context): PaymentWebhookResult {
            $topUp = $this->topUps->findForUpdate($notification->topUpId)
                ?? throw new TopUpNotFoundException($notification->topUpId);

            if ($notification->amountMinor !== $topUp->priceMinor()) {
                throw new AmountMismatchException($topUp->priceMinor(), $notification->amountMinor);
            }

            if ($topUp->isPaid()) {
                return new PaymentWebhookResult(true, TopUpStatus::Paid, $topUp);
            }

            $other = $this->topUps->findByGatewayRef($notification->gatewayRef);
            if ($other !== null && $other->id !== $topUp->id) {
                throw new GatewayRefConflictException($notification->gatewayRef);
            }

            return match ($notification->status) {
                'PAID' => $this->credit($topUp, $notification, $context),
                'FAILED' => $this->terminate($topUp, $notification, false),
                default => $this->terminate($topUp, $notification, true),
            };
        });
    }

    private function credit(TopUp $topUp, PaymentNotification $n, EventContext $context): PaymentWebhookResult
    {
        $now = $this->clock->now();
        $wallet = $this->wallets->lockOrCreate($topUp->userId);
        $entry = $wallet->credit(
            Credits::of($topUp->amountCredits()),
            OperationRef::topUp($topUp->id),
            $this->ids->next(),
            new EntryContext(topUpId: $topUp->id),
            $now,
        );
        $topUp->markPaid($n->gatewayRef, $now);
        $this->wallets->save($wallet);
        $this->topUps->save($topUp);
        $this->events->publish(new TopUpPaid(
            $topUp->id,
            $topUp->userId,
            $topUp->package->value,
            $topUp->amountCredits(),
            $n->gatewayRef,
            $entry->id,
            $wallet->balance()->amount,
            $now,
        ), $context);

        return new PaymentWebhookResult(false, TopUpStatus::Paid, $topUp);
    }

    private function terminate(TopUp $topUp, PaymentNotification $n, bool $expired): PaymentWebhookResult
    {
        $before = $topUp->status();
        $expired ? $topUp->markExpired() : $topUp->markFailed($n->gatewayRef);
        if ($before === $topUp->status()) {
            return new PaymentWebhookResult(true, $topUp->status(), $topUp);
        }
        $this->topUps->save($topUp);

        return new PaymentWebhookResult(false, $topUp->status(), $topUp);
    }
}
