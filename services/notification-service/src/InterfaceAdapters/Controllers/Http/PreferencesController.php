<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Controllers\Http;

use Bandada\Notification\Entities\ChannelSet;
use Bandada\Notification\Entities\NotificationType;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Security\Principal;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Support\JsonBody;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Support\RequestValidator;
use Bandada\Notification\InterfaceAdapters\Presenters\Presenter;
use Bandada\Notification\UseCases\Devices\GetPreferences;
use Bandada\Notification\UseCases\Devices\UpdatePreferences;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

final readonly class PreferencesController
{
    public function __construct(private GetPreferences $get, private UpdatePreferences $update) {}

    /** getNotificationPreferences */
    public function show(Request $request): JsonResponse
    {
        return new JsonResponse(Presenter::preferences($this->get->execute($this->principal($request)->subject)));
    }

    /** updateNotificationPreferences (PUT replaces everything) */
    public function replace(Request $request): JsonResponse
    {
        $input = JsonBody::parse($request->getContent());
        $rules = [
            'channels' => ['required', 'array'],
            'channels.push' => ['required', 'boolean'],
            'channels.email' => ['required', 'boolean'],
            'channels.inApp' => ['required', 'boolean'],
            'mutedTypes' => ['required', 'array'],
            'mutedTypes.*' => ['string', Rule::in(array_map(static fn (NotificationType $t): string => $t->value, NotificationType::cases()))],
        ];
        foreach (array_diff(array_keys($input), ['channels', 'mutedTypes']) as $unknown) {
            $rules[(string) $unknown] = ['prohibited'];
        }
        $body = RequestValidator::validate($input, $rules);
        if (count($body['mutedTypes']) !== count(array_unique($body['mutedTypes']))) {
            RequestValidator::validate(['mutedTypes' => $body['mutedTypes']], ['mutedTypes' => ['array'], 'mutedTypes.*' => ['distinct']]);
        }

        $preferences = $this->update->execute(
            $this->principal($request)->subject,
            new ChannelSet((bool) $body['channels']['push'], (bool) $body['channels']['email'], (bool) $body['channels']['inApp']),
            array_values(array_map(static fn (string $t): NotificationType => NotificationType::from($t), $body['mutedTypes'])),
        );

        return new JsonResponse(Presenter::preferences($preferences));
    }

    private function principal(Request $request): Principal
    {
        /** @var Principal $principal */
        $principal = $request->attributes->get('principal');

        return $principal;
    }
}
