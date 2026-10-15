<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Out\Messaging;

use Bandada\Wallet\Adapter\Shared\Messaging\Traceparent;
use Bandada\Wallet\Adapter\Shared\Support\Timestamps;
use Bandada\Wallet\Domain\Event\CreditsDebited;
use Bandada\Wallet\Domain\Event\CreditsDebitFailed;
use Bandada\Wallet\Domain\Event\CreditsRefunded;
use Bandada\Wallet\Domain\Event\DomainEvent;
use Bandada\Wallet\Domain\Event\EventContext;
use Bandada\Wallet\Domain\Event\TopUpPaid;
use InvalidArgumentException;

/** Maps domain events to CloudEvents 1.0 (structured mode) following bandada-events.yaml. */
final readonly class CloudEventFactory
{
    public function __construct(private string $source = '/services/wallet-service') {}

    /**
     * @return array{routingKey:string,subject:string,payload:array<string,mixed>,traceparent:string}
     */
    public function build(string $id, DomainEvent $event, EventContext $context): array
    {
        [$type, $subject, $data, $sagaId] = match (true) {
            $event instanceof CreditsDebited => [
                'bandada.wallet.credits-debited.v1',
                'registration/'.$event->registrationId,
                [
                    'sagaId' => $event->sagaId,
                    'registrationId' => $event->registrationId,
                    'idempotencyKey' => $event->idempotencyKey,
                    'userId' => $event->userId,
                    'ledgerEntryId' => $event->ledgerEntryId,
                    'amountCredits' => $event->amountCredits,
                    'balanceCredits' => $event->balanceCredits,
                    'occurredAt' => Timestamps::toApi($event->occurredAt),
                ],
                $event->sagaId,
            ],
            $event instanceof CreditsDebitFailed => [
                'bandada.wallet.credits-debit-failed.v1',
                'registration/'.$event->registrationId,
                [
                    'sagaId' => $event->sagaId,
                    'registrationId' => $event->registrationId,
                    'idempotencyKey' => $event->idempotencyKey,
                    'userId' => $event->userId,
                    'reason' => $event->reason,
                    'requiredCredits' => $event->requiredCredits,
                    'balanceCredits' => $event->balanceCredits,
                    'occurredAt' => Timestamps::toApi($event->occurredAt),
                ],
                $event->sagaId,
            ],
            $event instanceof CreditsRefunded => [
                'bandada.wallet.credits-refunded.v1',
                'registration/'.$event->registrationId,
                [
                    'sagaId' => $event->sagaId,
                    'registrationId' => $event->registrationId,
                    'idempotencyKey' => $event->idempotencyKey,
                    'userId' => $event->userId,
                    'ledgerEntryId' => $event->ledgerEntryId,
                    'amountCredits' => $event->amountCredits,
                    'balanceCredits' => $event->balanceCredits,
                    'occurredAt' => Timestamps::toApi($event->occurredAt),
                ],
                $event->sagaId,
            ],
            $event instanceof TopUpPaid => [
                'bandada.wallet.topup.paid.v1',
                'topup/'.$event->topUpId,
                [
                    'topUpId' => $event->topUpId,
                    'userId' => $event->userId,
                    'package' => $event->package,
                    'amountCredits' => $event->amountCredits,
                    'gatewayRef' => $event->gatewayRef,
                    'ledgerEntryId' => $event->ledgerEntryId,
                    'balanceCredits' => $event->balanceCredits,
                    'occurredAt' => Timestamps::toApi($event->occurredAt),
                ],
                null,
            ],
            default => throw new InvalidArgumentException('Unsupported domain event '.$event::class),
        };

        $traceparent = Traceparent::child($context->traceparent);
        $payload = [
            'specversion' => '1.0',
            'id' => $id,
            'source' => $this->source,
            'type' => $type,
            'time' => Timestamps::toApi($event->occurredAt()),
            'subject' => $subject,
            'datacontenttype' => 'application/json',
            'traceparent' => $traceparent,
            'data' => $data,
        ];
        if ($context->correlationId !== null) {
            $payload['correlationid'] = $context->correlationId;
        }
        if ($context->causationId !== null) {
            $payload['causationid'] = $context->causationId;
        }
        $sagaId ??= $context->sagaId;
        if ($sagaId !== null) {
            $payload['sagaid'] = $sagaId;
        }

        return ['routingKey' => $type, 'subject' => $subject, 'payload' => $payload, 'traceparent' => $traceparent];
    }
}
