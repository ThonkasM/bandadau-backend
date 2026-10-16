<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\UseCase;

use Bandada\Wallet\Application\Port\In\GetTopSpendersUseCase;
use Bandada\Wallet\Application\Port\In\TopSpenders;
use Bandada\Wallet\Application\Port\In\TopSpendersQuery;
use Bandada\Wallet\Application\Port\Out\TopSpendersRepository;
use Bandada\Wallet\Domain\Exception\InvalidStatsRangeException;
use DateInterval;

final readonly class GetTopSpendersService implements GetTopSpendersUseCase
{
    private const int MAX_RANGE_DAYS = 366;

    private const int MAX_LIMIT = 20;

    public function __construct(private TopSpendersRepository $ranking) {}

    public function handle(TopSpendersQuery $query): TopSpenders
    {
        $from = $query->from->setTime(0, 0);
        $to = $query->to->setTime(0, 0);
        if ($to < $from) {
            throw new InvalidStatsRangeException('"to" must not precede "from"');
        }
        if ($from->diff($to)->days > self::MAX_RANGE_DAYS) {
            throw new InvalidStatsRangeException('Range cannot exceed '.self::MAX_RANGE_DAYS.' days');
        }
        $limit = max(1, min(self::MAX_LIMIT, $query->limit));

        return new TopSpenders(
            $from->format('Y-m-d'),
            $to->format('Y-m-d'),
            $this->ranking->topSpenders($from, $to->add(new DateInterval('P1D')), $limit),
        );
    }
}
