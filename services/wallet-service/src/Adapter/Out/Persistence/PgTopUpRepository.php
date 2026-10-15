<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\Out\Persistence;

use Bandada\Wallet\Adapter\Shared\Support\Timestamps;
use Bandada\Wallet\Application\Port\Out\TopUpRepository;
use Bandada\Wallet\Domain\Exception\DuplicateTopUpException;
use Bandada\Wallet\Domain\Model\TopUp;
use Bandada\Wallet\Domain\Model\TopUpPackage;
use Bandada\Wallet\Domain\Model\TopUpStatus;
use DateTimeImmutable;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\UniqueConstraintViolationException;

final readonly class PgTopUpRepository implements TopUpRepository
{
    public function __construct(private ConnectionInterface $db) {}

    public function add(TopUp $topUp): void
    {
        try {
            $this->db->table('top_ups')->insert([
                'id' => $topUp->id,
                'user_id' => $topUp->userId,
                'package' => $topUp->package->value,
                'amount_credits' => $topUp->amountCredits(),
                'price_minor' => $topUp->priceMinor(),
                'currency' => $topUp->currency,
                'status' => $topUp->status()->value,
                'gateway_ref' => $topUp->gatewayRef(),
                'idempotency_key' => $topUp->idempotencyKey,
                'expires_at' => Timestamps::toDb($topUp->expiresAt),
                'paid_at' => $topUp->paidAt() === null ? null : Timestamps::toDb($topUp->paidAt()),
                'created_at' => Timestamps::toDb($topUp->createdAt),
                'updated_at' => Timestamps::toDb($topUp->createdAt),
            ]);
        } catch (UniqueConstraintViolationException $e) {
            if (str_contains($e->getMessage(), 'ux_topups_user_idempotency')) {
                throw new DuplicateTopUpException('Duplicate top-up for idempotency key', 0, $e);
            }
            throw $e;
        }
    }

    public function find(string $id): ?TopUp
    {
        $row = $this->db->table('top_ups')->where('id', $id)->first();

        return $row === null ? null : $this->hydrate($row);
    }

    public function findForUpdate(string $id): ?TopUp
    {
        $row = $this->db->table('top_ups')->where('id', $id)->lockForUpdate()->first();

        return $row === null ? null : $this->hydrate($row);
    }

    public function findByGatewayRef(string $gatewayRef): ?TopUp
    {
        $row = $this->db->table('top_ups')->where('gateway_ref', $gatewayRef)->first();

        return $row === null ? null : $this->hydrate($row);
    }

    public function findByUserAndIdempotencyKey(string $userId, string $idempotencyKey): ?TopUp
    {
        $row = $this->db->table('top_ups')->where('user_id', $userId)->where('idempotency_key', $idempotencyKey)->first();

        return $row === null ? null : $this->hydrate($row);
    }

    public function save(TopUp $topUp): void
    {
        $this->db->table('top_ups')->where('id', $topUp->id)->update([
            'status' => $topUp->status()->value,
            'gateway_ref' => $topUp->gatewayRef(),
            'paid_at' => $topUp->paidAt() === null ? null : Timestamps::toDb($topUp->paidAt()),
            'updated_at' => Timestamps::toDb(new DateTimeImmutable),
        ]);
    }

    public function expireDue(DateTimeImmutable $now): int
    {
        return $this->db->table('top_ups')
            ->where('status', TopUpStatus::Pending->value)
            ->where('expires_at', '<=', Timestamps::toDb($now))
            ->update(['status' => TopUpStatus::Expired->value, 'updated_at' => Timestamps::toDb($now)]);
    }

    private function hydrate(object $row): TopUp
    {
        $r = (array) $row;

        return TopUp::reconstitute(
            (string) $r['id'],
            (string) $r['user_id'],
            TopUpPackage::from((string) $r['package']),
            (string) $r['currency'],
            $r['idempotency_key'] === null ? null : (string) $r['idempotency_key'],
            Timestamps::fromDb((string) $r['created_at']),
            Timestamps::fromDb((string) $r['expires_at']),
            TopUpStatus::from((string) $r['status']),
            $r['gateway_ref'] === null ? null : (string) $r['gateway_ref'],
            $r['paid_at'] === null ? null : Timestamps::fromDb((string) $r['paid_at']),
        );
    }
}
