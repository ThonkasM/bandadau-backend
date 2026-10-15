<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Http\Controllers;

use Bandada\Wallet\Adapter\In\Http\Presenters\Presenter;
use Bandada\Wallet\Adapter\In\Http\Security\Principal;
use Bandada\Wallet\Adapter\In\Http\Support\LedgerCursorCodec;
use Bandada\Wallet\Adapter\In\Http\Support\RequestValidator;
use Bandada\Wallet\Application\Port\In\GetMyWalletUseCase;
use Bandada\Wallet\Application\Port\In\ListLedgerEntriesQuery;
use Bandada\Wallet\Application\Port\In\ListLedgerEntriesUseCase;
use Bandada\Wallet\Domain\Model\LedgerEntryType;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

final readonly class WalletController
{
    public function __construct(
        private GetMyWalletUseCase $getMyWallet,
        private ListLedgerEntriesUseCase $listEntries,
    ) {}

    /** getMyWallet */
    public function show(Request $request): JsonResponse
    {
        return new JsonResponse(Presenter::wallet($this->getMyWallet->handle($this->principal($request)->subject)));
    }

    /** listMyLedgerEntries */
    public function entries(Request $request): JsonResponse
    {
        $params = RequestValidator::validate($request->query(), [
            'cursor' => ['sometimes', 'string', 'max:512'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:50'],
            'type' => ['sometimes', 'string', Rule::in(array_map(static fn (LedgerEntryType $t): string => $t->value, LedgerEntryType::cases()))],
        ]);

        $page = $this->listEntries->handle(new ListLedgerEntriesQuery(
            $this->principal($request)->subject,
            (int) ($params['limit'] ?? 20),
            isset($params['cursor']) ? LedgerCursorCodec::decode((string) $params['cursor']) : null,
            isset($params['type']) ? LedgerEntryType::from((string) $params['type']) : null,
        ));

        $locale = (string) $request->attributes->get('locale', 'es');

        return new JsonResponse([
            'items' => array_map(static fn ($e): array => Presenter::ledgerEntry($e, $locale), $page->items),
            'nextCursor' => $page->next === null ? null : LedgerCursorCodec::encode($page->next),
        ]);
    }

    private function principal(Request $request): Principal
    {
        /** @var Principal $principal */
        $principal = $request->attributes->get('principal');

        return $principal;
    }
}
