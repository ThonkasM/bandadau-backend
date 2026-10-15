<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\UseCase;

use Bandada\Wallet\Application\Port\In\CreateTopUpCommand;
use Bandada\Wallet\Application\Port\In\CreateTopUpUseCase;
use Bandada\Wallet\Application\Port\In\TopUpView;
use Bandada\Wallet\Application\Port\Out\Clock;
use Bandada\Wallet\Application\Port\Out\IdGenerator;
use Bandada\Wallet\Application\Port\Out\PaymentGateway;
use Bandada\Wallet\Application\Port\Out\TopUpRepository;
use Bandada\Wallet\Application\Port\Out\TransactionManager;
use Bandada\Wallet\Domain\Exception\DuplicateTopUpException;
use Bandada\Wallet\Domain\Exception\InvalidTopUpPackageException;
use Bandada\Wallet\Domain\Model\TopUp;
use Bandada\Wallet\Domain\Model\TopUpPackage;
use DateInterval;

final readonly class CreateTopUpService implements CreateTopUpUseCase
{
    /** @param list<string> $enabledPackages package codes enabled by configuration */
    public function __construct(
        private TopUpRepository $topUps,
        private PaymentGateway $gateway,
        private TransactionManager $tx,
        private Clock $clock,
        private IdGenerator $ids,
        private array $enabledPackages,
        private int $ttlMinutes,
    ) {}

    public function handle(CreateTopUpCommand $command): TopUpView
    {
        $package = TopUpPackage::tryFrom($command->package);
        if ($package === null || ! in_array($package->value, $this->enabledPackages, true)) {
            throw new InvalidTopUpPackageException($command->package);
        }

        // Business-level idempotency (D3 mechanism 3): one top-up per (user, Idempotency-Key).
        $existing = $this->topUps->findByUserAndIdempotencyKey($command->userId, $command->idempotencyKey);
        if ($existing !== null) {
            return $this->view($existing);
        }

        $now = $this->clock->now();
        $topUp = TopUp::create(
            $this->ids->next(),
            $command->userId,
            $package,
            $command->idempotencyKey,
            $now,
            $now->add(new DateInterval('PT'.$this->ttlMinutes.'M')),
        );

        try {
            $this->tx->run(fn () => $this->topUps->add($topUp));
        } catch (DuplicateTopUpException) {
            $winner = $this->topUps->findByUserAndIdempotencyKey($command->userId, $command->idempotencyKey);
            if ($winner !== null) {
                return $this->view($winner);
            }
            throw new DuplicateTopUpException('Top-up vanished after a duplicate conflict');
        }

        return $this->view($topUp);
    }

    private function view(TopUp $topUp): TopUpView
    {
        return new TopUpView($topUp, $topUp->statusAt($this->clock->now()), $this->gateway->checkoutUrl($topUp));
    }
}
