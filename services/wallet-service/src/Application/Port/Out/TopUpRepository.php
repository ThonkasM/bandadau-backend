<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\Out;

use Bandada\Wallet\Domain\Exception\DuplicateTopUpException;
use Bandada\Wallet\Domain\Model\TopUp;
use DateTimeImmutable;

interface TopUpRepository
{
    /** @throws DuplicateTopUpException when (user, idempotency key) already exists */
    public function add(TopUp $topUp): void;

    public function find(string $id): ?TopUp;

    public function findForUpdate(string $id): ?TopUp;

    public function findByGatewayRef(string $gatewayRef): ?TopUp;

    public function findByUserAndIdempotencyKey(string $userId, string $idempotencyKey): ?TopUp;

    public function save(TopUp $topUp): void;

    public function expireDue(DateTimeImmutable $now): int;
}
