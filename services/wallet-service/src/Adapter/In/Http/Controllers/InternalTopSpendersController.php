<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Http\Controllers;

use Bandada\Wallet\Adapter\In\Http\Support\RequestValidator;
use Bandada\Wallet\Application\Port\In\GetTopSpendersUseCase;
use Bandada\Wallet\Application\Port\In\TopSpendersQuery;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** getTopSpenders (GET /internal/v1/stats/top-spenders). */
final readonly class InternalTopSpendersController
{
    public function __construct(private GetTopSpendersUseCase $ranking) {}

    public function __invoke(Request $request): JsonResponse
    {
        $params = RequestValidator::validate($request->query(), [
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d'],
            'limit' => ['sometimes', 'integer', 'between:1,20'],
        ]);
        $utc = new DateTimeZone('UTC');

        $result = $this->ranking->handle(new TopSpendersQuery(
            new DateTimeImmutable((string) $params['from'].' 00:00:00', $utc),
            new DateTimeImmutable((string) $params['to'].' 00:00:00', $utc),
            (int) ($params['limit'] ?? 10),
        ));

        return new JsonResponse(['from' => $result->from, 'to' => $result->to, 'items' => $result->items]);
    }
}
