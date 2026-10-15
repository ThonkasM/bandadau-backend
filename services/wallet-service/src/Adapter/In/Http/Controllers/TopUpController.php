<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Http\Controllers;

use Bandada\Wallet\Adapter\In\Http\Presenters\Presenter;
use Bandada\Wallet\Adapter\In\Http\Security\Principal;
use Bandada\Wallet\Adapter\In\Http\Support\JsonBody;
use Bandada\Wallet\Adapter\In\Http\Support\RequestValidator;
use Bandada\Wallet\Application\Port\In\CreateTopUpCommand;
use Bandada\Wallet\Application\Port\In\CreateTopUpUseCase;
use Bandada\Wallet\Application\Port\In\GetTopUpUseCase;
use Bandada\Wallet\Application\Port\In\SimulatePaymentUseCase;
use Bandada\Wallet\Domain\Event\EventContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

final readonly class TopUpController
{
    /** @param list<string> $enabledPackages */
    public function __construct(
        private CreateTopUpUseCase $createTopUp,
        private GetTopUpUseCase $getTopUp,
        private SimulatePaymentUseCase $simulatePayment,
        private array $enabledPackages,
    ) {}

    /** createTopUp */
    public function store(Request $request): JsonResponse
    {
        $body = RequestValidator::validate(JsonBody::parse($request->getContent()), [
            'package' => ['required', 'string', Rule::in($this->enabledPackages)],
        ]);
        $principal = $this->principal($request);

        $creation = $this->createTopUp->handle(new CreateTopUpCommand(
            $principal->subject,
            (string) $body['package'],
            strtolower((string) $request->header('Idempotency-Key')),
        ));

        return new JsonResponse(
            Presenter::topUpCreated($creation),
            201,
            ['Location' => '/api/v1/wallet/topups/'.$creation->topUp->id],
        );
    }

    /** getTopUp */
    public function show(Request $request, string $topUpId): JsonResponse
    {
        $this->assertUuid($topUpId);
        $topUp = $this->getTopUp->handle($this->principal($request)->subject, $topUpId);

        return new JsonResponse(Presenter::topUp($topUp));
    }

    /** simulateTopUpPayment (404 unless PAYMENT_SIMULATOR_ENABLED) */
    public function simulate(Request $request, string $topUpId): JsonResponse
    {
        $this->assertUuid($topUpId);
        $input = JsonBody::parse($request->getContent(), allowEmpty: true);
        $rules = ['outcome' => ['sometimes', 'string', Rule::in(['PAID', 'FAILED'])]];
        foreach (array_diff(array_keys($input), ['outcome']) as $unknown) {
            $rules[(string) $unknown] = ['prohibited'];
        }
        $body = RequestValidator::validate($input, $rules);

        $topUp = $this->simulatePayment->handle(
            $this->principal($request)->subject,
            $topUpId,
            ($body['outcome'] ?? 'PAID') === 'FAILED' ? 'FAILED' : 'PAID',
            new EventContext((string) $request->attributes->get('correlationId'), null, null, (string) $request->attributes->get('traceparent')),
        );

        return new JsonResponse(Presenter::topUp($topUp));
    }

    private function assertUuid(string $value): void
    {
        RequestValidator::validate(['topUpId' => $value], ['topUpId' => ['required', 'uuid']]);
    }

    private function principal(Request $request): Principal
    {
        /** @var Principal $principal */
        $principal = $request->attributes->get('principal');

        return $principal;
    }
}
