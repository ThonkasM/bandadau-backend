<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Gateways\WebPush;

use Bandada\Notification\Entities\DevicePlatform;
use Bandada\Notification\UseCases\Ports\PushResult;
use Bandada\Notification\UseCases\Ports\PushSender;
use Bandada\Notification\UseCases\Ports\RenderedMessage;
use Throwable;

/**
 * Routes each device to the right provider: IOS/ANDROID -> Expo, WEB -> Web Push (VAPID). A failure of one provider does not
 * hide the other's result; if every attempted provider failed, the first error is rethrown (the delivery is marked FAILED).
 */
final readonly class PlatformRoutingPushSender implements PushSender
{
    public function __construct(private PushSender $mobile, private ?PushSender $web) {}

    public function send(array $devices, RenderedMessage $message, array $data): PushResult
    {
        $mobile = array_values(array_filter($devices, static fn ($d): bool => $d->platform !== DevicePlatform::Web));
        $web = $this->web === null ? [] : array_values(array_filter($devices, static fn ($d): bool => $d->platform === DevicePlatform::Web));

        $delivered = false;
        $invalid = [];
        $attempted = 0;
        $firstError = null;
        foreach ([[$this->mobile, $mobile], [$this->web, $web]] as [$sender, $group]) {
            if ($sender === null || $group === []) {
                continue;
            }
            $attempted++;
            try {
                $result = $sender->send($group, $message, $data);
                $delivered = $delivered || $result->delivered;
                $invalid = [...$invalid, ...$result->invalidTokens];
            } catch (Throwable $e) {
                $firstError ??= $e;
            }
        }
        if ($firstError !== null && $attempted > 0 && ! $delivered && $invalid === []) {
            throw $firstError;
        }

        return new PushResult($delivered, $invalid);
    }
}
