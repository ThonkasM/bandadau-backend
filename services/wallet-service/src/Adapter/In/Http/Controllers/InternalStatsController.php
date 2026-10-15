<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Http\Controllers;

use Bandada\Wallet\Adapter\In\Http\Support\RequestValidator;
use Bandada\Wallet\Application\Port\In\CreditStatsQuery;
use Bandada\Wallet\Application\Port\In\GetCreditStatsUseCase;
use Bandada\Wallet\Domain\Model\StatsGroupBy;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** getCreditStats (GET /internal/v1/stats/credits). */
final readonly class InternalStatsController
{
    public function __construct(private GetCreditStatsUseCase $stats) {}

    public function __invoke(Request $request): JsonResponse
    {
        $params = RequestValidator::validate($request->query(), [
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d'],
            'groupBy' => ['sometimes', 'string', Rule::in(array_map(static fn (StatsGroupBy $g): string => $g->value, StatsGroupBy::cases()))],
        ]);
        $utc = new DateTimeZone('UTC');

        $stats = $this->stats->handle(new CreditStatsQuery(
            new DateTimeImmutable((string) $params['from'].' 00:00:00', $utc),
            new DateTimeImmutable((string) $params['to'].' 00:00:00', $utc),
            StatsGroupBy::from((string) ($params['groupBy'] ?? 'day')),
        ));

        return new JsonResponse([
            'from' => $stats->from,
            'to' => $stats->to,
            'groupBy' => $stats->groupBy,
            'totals' => $stats->totals,
            'series' => $stats->series,
        ]);
    }
}
