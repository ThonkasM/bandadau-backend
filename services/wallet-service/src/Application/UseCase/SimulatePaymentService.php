<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\UseCase;

use Bandada\Wallet\Application\Port\In\HandlePaymentWebhookUseCase;
use Bandada\Wallet\Application\Port\In\PaymentNotification;
use Bandada\Wallet\Application\Port\In\SimulatePaymentUseCase;
use Bandada\Wallet\Application\Port\In\TopUpView;
use Bandada\Wallet\Application\Port\Out\Clock;
use Bandada\Wallet\Application\Port\Out\IdGenerator;
use Bandada\Wallet\Application\Port\Out\PaymentGateway;
use Bandada\Wallet\Application\Port\Out\TopUpRepository;
use Bandada\Wallet\Domain\Event\EventContext;
use Bandada\Wallet\Domain\Exception\ForbiddenOperationException;
use Bandada\Wallet\Domain\Exception\SimulatorDisabledException;
use Bandada\Wallet\Domain\Exception\TopUpNotFoundException;
use Bandada\Wallet\Domain\Exception\TopUpNotPendingException;
use Bandada\Wallet\Domain\Model\TopUpStatus;

/** Plays the gateway: builds the callback and feeds it to the same use case as the real webhook. */
final readonly class SimulatePaymentService implements SimulatePaymentUseCase
{
    public function __construct(
        private TopUpRepository $topUps,
        private PaymentGateway $gateway,
        private HandlePaymentWebhookUseCase $webhook,
        private Clock $clock,
        private IdGenerator $ids,
    ) {}

    public function handle(string $userId, string $topUpId, string $outcome, EventContext $context): TopUpView
    {
        if (! $this->gateway->simulatorEnabled()) {
            throw new SimulatorDisabledException;
        }
        $topUp = $this->topUps->find($topUpId) ?? throw new TopUpNotFoundException($topUpId);
        if ($topUp->userId !== $userId) {
            throw new ForbiddenOperationException('Top-up belongs to another user');
        }

        $now = $this->clock->now();
        $status = $topUp->statusAt($now);
        $target = $outcome === 'PAID' ? TopUpStatus::Paid : TopUpStatus::Failed;
        if ($status === $target) {
            return new TopUpView($topUp, $status);
        }
        if ($status !== TopUpStatus::Pending) {
            throw new TopUpNotPendingException($topUpId, $status->value);
        }

        $result = $this->webhook->handle(new PaymentNotification(
            'evt_'.str_replace('-', '', $this->ids->next()),
            $this->gateway->simulatedGatewayRef($topUp),
            $topUp->id,
            $outcome,
            $topUp->priceMinor(),
            $topUp->currency,
            $now,
        ), $context);

        return new TopUpView($result->topUp, $result->topUp->statusAt($this->clock->now()));
    }
}
