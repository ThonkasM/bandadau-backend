<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Controllers\Http;

use Bandada\Notification\Entities\DevicePlatform;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Security\Principal;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Support\JsonBody;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Support\RequestValidator;
use Bandada\Notification\InterfaceAdapters\Presenters\Presenter;
use Bandada\Notification\UseCases\Devices\RegisterDevice;
use Bandada\Notification\UseCases\Devices\UnregisterDevice;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

final readonly class DeviceController
{
    public function __construct(private RegisterDevice $register, private UnregisterDevice $unregister) {}

    /** registerDevice (PUT /devices/{token}) */
    public function register(Request $request, string $token): JsonResponse
    {
        RequestValidator::validate(['token' => $token], ['token' => ['required', 'string', 'min:8', 'max:512']]);
        $body = RequestValidator::validate(JsonBody::parse($request->getContent()), [
            'platform' => ['required', 'string', Rule::in(array_map(static fn (DevicePlatform $p): string => $p->value, DevicePlatform::cases()))],
            'appVersion' => ['sometimes', 'nullable', 'string', 'max:32'],
            'deviceName' => ['sometimes', 'nullable', 'string', 'max:80'],
            'webPushSubscription' => ['sometimes', 'array'],
            'webPushSubscription.endpoint' => ['required_with:webPushSubscription', 'url'],
            'webPushSubscription.keys.p256dh' => ['required_with:webPushSubscription', 'string'],
            'webPushSubscription.keys.auth' => ['required_with:webPushSubscription', 'string'],
        ]);
        $unknown = array_diff(array_keys(JsonBody::parse($request->getContent())), ['platform', 'appVersion', 'deviceName', 'webPushSubscription']);
        if ($unknown !== []) {
            RequestValidator::validate(array_fill_keys($unknown, 1), array_fill_keys($unknown, ['prohibited']));
        }

        $device = $this->register->execute(
            $this->principal($request)->subject,
            $token,
            DevicePlatform::from((string) $body['platform']),
            isset($body['appVersion']) ? (string) $body['appVersion'] : null,
            isset($body['deviceName']) ? (string) $body['deviceName'] : null,
        );

        return new JsonResponse(Presenter::device($device));
    }

    /** unregisterDevice (DELETE /devices/{token}) */
    public function unregister(Request $request, string $token): Response
    {
        $this->unregister->execute($this->principal($request)->subject, $token);

        return new Response(null, 204);
    }

    private function principal(Request $request): Principal
    {
        /** @var Principal $principal */
        $principal = $request->attributes->get('principal');

        return $principal;
    }
}
