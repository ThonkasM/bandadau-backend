<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Messaging;

use Bandada\Wallet\Adapter\Shared\Messaging\CloudEvent;
use Bandada\Wallet\Adapter\Shared\Messaging\Exception\InvalidMessageException;
use Bandada\Wallet\Application\Port\In\DebitCreditsCommand;
use Bandada\Wallet\Application\Port\In\DebitCreditsUseCase;
use Bandada\Wallet\Application\Port\In\RefundCreditsCommand;
use Bandada\Wallet\Application\Port\In\RefundCreditsUseCase;
use Bandada\Wallet\Domain\Event\EventContext;

/** Routes SAGA commands to use cases by CloudEvents type. All business logic lives in the use cases. */
final readonly class WalletCommandHandler
{
    public const string DEBIT = 'bandada.wallet.cmd.debit-credits.v1';

    public const string REFUND = 'bandada.wallet.cmd.refund-credits.v1';

    public function __construct(
        private DebitCreditsUseCase $debit,
        private RefundCreditsUseCase $refund,
    ) {}

    /** @throws InvalidMessageException for messages that can never succeed */
    public function handle(CloudEvent $event): void
    {
        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $event->id) !== 1) {
            throw new InvalidMessageException('CloudEvent id must be a UUID');
        }
        $context = new EventContext(
            $event->correlationId,
            $event->id,
            $event->sagaId ?? (is_string($event->data['sagaId'] ?? null) ? $event->data['sagaId'] : null),
            $event->traceparent,
        );
        $d = new MessageData($event->data);

        match ($event->type) {
            self::DEBIT => $this->debit->handle(new DebitCreditsCommand(
                $event->id,
                $d->uuid('sagaId'),
                $d->uuid('registrationId'),
                $d->string('idempotencyKey'),
                $d->uuid('userId'),
                $d->uuid('eventId'),
                $d->positiveInt('amountCredits'),
                $d->optionalString('description'),
                $context,
            )),
            self::REFUND => $this->refund->handle(new RefundCreditsCommand(
                $event->id,
                $d->uuid('sagaId'),
                $d->uuid('registrationId'),
                $d->string('idempotencyKey'),
                $d->uuid('userId'),
                $d->nonNegativeInt('amountCredits'),
                $d->string('reason'),
                $context,
            )),
            default => throw new InvalidMessageException("Unsupported message type {$event->type}"),
        };
    }
}
