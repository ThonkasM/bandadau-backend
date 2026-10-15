<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Controllers\Http;

use Bandada\Notification\Entities\Channel;
use Bandada\Notification\Entities\NotificationType;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Support\JsonBody;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Support\RequestValidator;
use Bandada\Notification\UseCases\Notify\SendNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** sendNotification (POST /internal/v1/notifications), idempotent through the Idempotency-Key middleware. */
final readonly class InternalNotificationController
{
    public function __construct(private SendNotification $send) {}

    public function __invoke(Request $request): JsonResponse
    {
        $input = JsonBody::parse($request->getContent());
        $rules = [
            'userIds' => ['required', 'array', 'min:1', 'max:1000'],
            'userIds.*' => ['uuid'],
            'type' => ['required', 'string', Rule::in(array_map(static fn (NotificationType $t): string => $t->value, NotificationType::cases()))],
            'dedupeKey' => ['sometimes', 'string', 'max:200'],
            'params' => ['required', 'array'],
            'data' => ['sometimes', 'array'],
            'data.*' => ['string'],
            'channels' => ['sometimes', 'array'],
            'channels.*' => ['string', Rule::in(['PUSH', 'EMAIL', 'IN_APP'])],
        ];
        foreach (array_diff(array_keys($input), array_keys($rules), ['userIds', 'type', 'dedupeKey', 'params', 'data', 'channels']) as $unknown) {
            $rules[(string) $unknown] = ['prohibited'];
        }
        $body = RequestValidator::validate($input, $rules);

        $result = $this->send->execute(
            array_map('strtolower', array_values($body['userIds'])),
            NotificationType::from((string) $body['type']),
            $body['params'],
            array_map('strval', $body['data'] ?? []),
            isset($body['dedupeKey']) ? (string) $body['dedupeKey'] : null,
            isset($body['channels']) ? array_values(array_map(static fn (string $c): Channel => Channel::from($c), $body['channels'])) : null,
        );

        return new JsonResponse($result, 202);
    }
}
