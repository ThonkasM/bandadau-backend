<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\UseCase;

use Bandada\Wallet\Application\Port\In\GetTopUpUseCase;
use Bandada\Wallet\Application\Port\In\TopUpView;
use Bandada\Wallet\Application\Port\Out\Clock;
use Bandada\Wallet\Application\Port\Out\TopUpRepository;
use Bandada\Wallet\Domain\Exception\ForbiddenOperationException;
use Bandada\Wallet\Domain\Exception\TopUpNotFoundException;

final readonly class GetTopUpService implements GetTopUpUseCase
{
    public function __construct(private TopUpRepository $topUps, private Clock $clock) {}

    public function handle(string $userId, string $topUpId): TopUpView
    {
        $topUp = $this->topUps->find($topUpId) ?? throw new TopUpNotFoundException($topUpId);
        if ($topUp->userId !== $userId) {
            throw new ForbiddenOperationException('Top-up belongs to another user');
        }

        return new TopUpView($topUp, $topUp->statusAt($this->clock->now()));
    }
}
