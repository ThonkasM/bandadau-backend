<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Http\Controllers;

use Bandada\Wallet\Adapter\In\Http\Problem\ProblemException;
use Bandada\Wallet\Adapter\In\Http\Support\JsonBody;
use Bandada\Wallet\Adapter\In\Http\Support\RequestValidator;
use Bandada\Wallet\Application\Port\In\HandlePaymentWebhookUseCase;
use Bandada\Wallet\Application\Port\In\PaymentNotification;
use Bandada\Wallet\Domain\Event\EventContext;
use DateTimeImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Psr\Log\LoggerInterface;
use Throwable;

/** paymentWebhook: HMAC-SHA256 over the raw body, 5-minute anti-replay window, always 200 on duplicates. */
final readonly class PaymentWebhookController
{
    public function __construct(
        private HandlePaymentWebhookUseCase $handlePayment,
        private LoggerInterface $logger,
        private string $secret,
        private int $toleranceSeconds,
    ) {}

    public function __invoke(Request $request): JsonResponse
    {
        $raw = $request->getContent();
        $this->assertSignature($raw, (string) $request->header('X-Signature', ''));

        $body = RequestValidator::validate(JsonBody::parse($raw), [
            'eventId' => ['required', 'string', 'max:200'],
            'gatewayRef' => ['required', 'string', 'max:80'],
            'topUpId' => ['required', 'uuid'],
            'status' => ['required', 'string', Rule::in(['PAID', 'FAILED', 'EXPIRED'])],
            'amountMinor' => ['required', 'integer', 'min:0'],
            'currency' => ['required', 'string', 'max:8'],
            'occurredAt' => ['required', 'string', 'max:40'],
        ]);

        try {
            $occurredAt = new DateTimeImmutable((string) $body['occurredAt']);
        } catch (Throwable) {
            throw ProblemException::validation([[
                'field' => 'occurredAt', 'pointer' => '/occurredAt', 'code' => 'INVALID_FORMAT',
                'message' => (string) __('validation_codes.INVALID_FORMAT', ['field' => 'occurredAt']),
            ]]);
        }
        if (abs(time() - $occurredAt->getTimestamp()) > $this->toleranceSeconds) {
            $this->logger->warning('Webhook outside the anti-replay window', ['event' => 'webhook.expired', 'eventId' => $body['eventId']]);
            throw new ProblemException('WEBHOOK_EXPIRED');
        }

        $result = $this->handlePayment->handle(
            new PaymentNotification(
                (string) $body['eventId'],
                (string) $body['gatewayRef'],
                strtolower((string) $body['topUpId']),
                (string) $body['status'],
                (int) $body['amountMinor'],
                (string) $body['currency'],
                $occurredAt,
            ),
            new EventContext((string) $request->attributes->get('correlationId'), null, null, (string) $request->attributes->get('traceparent')),
        );

        if ($result->duplicate) {
            $this->logger->info('Duplicate payment webhook ignored', ['event' => 'webhook.duplicate', 'gatewayRef' => $body['gatewayRef']]);
        }

        return new JsonResponse([
            'received' => true,
            'duplicate' => $result->duplicate,
            'topUpStatus' => $result->topUpStatus->value,
        ]);
    }

    private function assertSignature(string $raw, string $header): void
    {
        $valid = preg_match('/^sha256=([0-9a-f]{64})$/', $header, $m) === 1
            && hash_equals(hash_hmac('sha256', $raw, $this->secret), $m[1]);
        if (! $valid) {
            $this->logger->warning('Webhook signature invalid', ['event' => 'webhook.signature_invalid']);
            throw new ProblemException('INVALID_SIGNATURE');
        }
    }
}
