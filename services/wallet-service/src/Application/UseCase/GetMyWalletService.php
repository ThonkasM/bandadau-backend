<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\UseCase;

use Bandada\Wallet\Application\Port\In\GetMyWalletUseCase;
use Bandada\Wallet\Application\Port\In\WalletView;
use Bandada\Wallet\Application\Port\Out\Clock;
use Bandada\Wallet\Application\Port\Out\WalletRepository;

/** Wallets are created lazily: a user without one sees a virtual wallet at zero. */
final readonly class GetMyWalletService implements GetMyWalletUseCase
{
    public function __construct(private WalletRepository $wallets, private Clock $clock) {}

    public function handle(string $userId): WalletView
    {
        $wallet = $this->wallets->findByUserId($userId);
        if ($wallet === null) {
            return new WalletView($userId, 0, $this->clock->now());
        }

        return new WalletView($userId, $wallet->balance()->amount, $wallet->updatedAt());
    }
}
