<?php

declare(strict_types=1);

namespace Bandada\Wallet\Domain\Model;

use DateTimeImmutable;

final class TopUp
{
    public const string CURRENCY = 'BOB';

    private function __construct(
        public readonly string $id,
        public readonly string $userId,
        public readonly TopUpPackage $package,
        public readonly string $currency,
        public readonly ?string $idempotencyKey,
        public readonly DateTimeImmutable $createdAt,
        public readonly DateTimeImmutable $expiresAt,
        private TopUpStatus $status,
        private ?string $gatewayRef,
        private ?DateTimeImmutable $paidAt,
    ) {}

    public static function create(
        string $id,
        string $userId,
        TopUpPackage $package,
        ?string $idempotencyKey,
        DateTimeImmutable $now,
        DateTimeImmutable $expiresAt,
    ): self {
        return new self($id, $userId, $package, self::CURRENCY, $idempotencyKey, $now, $expiresAt, TopUpStatus::Pending, null, null);
    }

    public static function reconstitute(
        string $id,
        string $userId,
        TopUpPackage $package,
        string $currency,
        ?string $idempotencyKey,
        DateTimeImmutable $createdAt,
        DateTimeImmutable $expiresAt,
        TopUpStatus $status,
        ?string $gatewayRef,
        ?DateTimeImmutable $paidAt,
    ): self {
        return new self($id, $userId, $package, $currency, $idempotencyKey, $createdAt, $expiresAt, $status, $gatewayRef, $paidAt);
    }

    public function status(): TopUpStatus
    {
        return $this->status;
    }

    /** Status as observed at `$now`: a PENDING top-up past its expiry reads as EXPIRED before the sweeper runs. */
    public function statusAt(DateTimeImmutable $now): TopUpStatus
    {
        if ($this->status === TopUpStatus::Pending && $this->expiresAt <= $now) {
            return TopUpStatus::Expired;
        }

        return $this->status;
    }

    public function gatewayRef(): ?string
    {
        return $this->gatewayRef;
    }

    public function paidAt(): ?DateTimeImmutable
    {
        return $this->paidAt;
    }

    public function amountCredits(): int
    {
        return $this->package->credits();
    }

    public function priceMinor(): int
    {
        return $this->package->priceMinor();
    }

    public function isPaid(): bool
    {
        return $this->status === TopUpStatus::Paid;
    }

    /** A payment is accepted even when the top-up already expired or failed: the money did arrive. */
    public function markPaid(string $gatewayRef, DateTimeImmutable $now): void
    {
        $this->status = TopUpStatus::Paid;
        $this->gatewayRef = $gatewayRef;
        $this->paidAt = $now;
    }

    public function markFailed(string $gatewayRef): void
    {
        if ($this->status === TopUpStatus::Pending) {
            $this->status = TopUpStatus::Failed;
            $this->gatewayRef = $gatewayRef;
        }
    }

    public function markExpired(): void
    {
        if ($this->status === TopUpStatus::Pending) {
            $this->status = TopUpStatus::Expired;
        }
    }
}
