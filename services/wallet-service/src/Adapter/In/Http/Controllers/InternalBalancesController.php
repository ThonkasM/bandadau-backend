<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Http\Controllers;

use Bandada\Wallet\Adapter\In\Http\Support\RequestValidator;
use Bandada\Wallet\Application\Port\In\GetBalanceOverviewUseCase;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** getBalanceOverview (GET /internal/v1/stats/balances). */
final readonly class InternalBalancesController
{
    public function __construct(private GetBalanceOverviewUseCase $overview) {}

    public function __invoke(Request $request): JsonResponse
    {
        $params = RequestValidator::validate($request->query(), [
            'limit' => ['sometimes', 'integer', 'between:1,20'],
        ]);

        $result = $this->overview->handle((int) ($params['limit'] ?? 5));

        return new JsonResponse([
            'creditsInCirculation' => $result->creditsInCirculation,
            'walletsWithBalance' => $result->walletsWithBalance,
            'averageBalance' => $result->averageBalance,
            'items' => $result->items,
        ]);
    }
}
