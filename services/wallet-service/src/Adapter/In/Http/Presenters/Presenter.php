<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Http\Presenters;

use Bandada\Wallet\Adapter\Shared\Support\Timestamps;
use Bandada\Wallet\Application\Port\In\TopUpView;
use Bandada\Wallet\Application\Port\In\WalletView;
use Bandada\Wallet\Domain\Model\LedgerEntry;
use Bandada\Wallet\Domain\Model\LedgerEntryType;
use Illuminate\Support\Facades\Lang;

/** Domain/application objects to the exact JSON shapes of wallet-service.yaml. */
final class Presenter
{
    /** @return array<string, mixed> */
    public static function wallet(WalletView $wallet): array
    {
        return [
            'userId' => $wallet->userId,
            'balanceCredits' => $wallet->balanceCredits,
            'updatedAt' => Timestamps::toApi($wallet->updatedAt),
        ];
    }

    /** @return array<string, mixed> */
    public static function ledgerEntry(LedgerEntry $entry, string $locale): array
    {
        return [
            'id' => $entry->id,
            'walletId' => $entry->walletUserId,
            'type' => $entry->type->value,
            'amountCredits' => $entry->amount->amount,
            'balanceAfterCredits' => $entry->balanceAfter->amount,
            'operationRef' => $entry->operationRef->value,
            'description' => self::description($entry, $locale),
            'registrationId' => $entry->context->registrationId,
            'eventId' => $entry->context->eventId,
            'topUpId' => $entry->context->topUpId,
            'createdAt' => Timestamps::toApi($entry->createdAt),
        ];
    }

    /** @return array<string, mixed> */
    public static function topUp(TopUpView $view): array
    {
        $topUp = $view->topUp;

        return [
            'id' => $topUp->id,
            'userId' => $topUp->userId,
            'package' => $topUp->package->value,
            'amountCredits' => $topUp->amountCredits(),
            'priceMinor' => $topUp->priceMinor(),
            'currency' => $topUp->currency,
            'status' => $view->status->value,
            'gatewayRef' => $topUp->gatewayRef(),
            'createdAt' => Timestamps::toApi($topUp->createdAt),
            'paidAt' => $topUp->paidAt() === null ? null : Timestamps::toApi($topUp->paidAt()),
            'expiresAt' => Timestamps::toApi($topUp->expiresAt),
        ];
    }

    /** @return array<string, mixed> */
    public static function topUpCreated(TopUpView $view): array
    {
        $topUp = $view->topUp;

        return [
            'topUpId' => $topUp->id,
            'checkoutUrl' => $view->checkoutUrl,
            'package' => $topUp->package->value,
            'amountCredits' => $topUp->amountCredits(),
            'priceMinor' => $topUp->priceMinor(),
            'currency' => $topUp->currency,
            'status' => $view->status->value,
            'expiresAt' => Timestamps::toApi($topUp->expiresAt),
        ];
    }

    private static function description(LedgerEntry $entry, string $locale): string
    {
        if ($entry->type === LedgerEntryType::Debit && $entry->context->description !== null) {
            return $entry->context->description;
        }

        return (string) Lang::get('ledger.'.$entry->type->value, ['credits' => $entry->amount->amount], $locale);
    }
}
