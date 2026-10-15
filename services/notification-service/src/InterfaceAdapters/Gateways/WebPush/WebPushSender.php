<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Gateways\WebPush;

use Bandada\Notification\Entities\DevicePlatform;
use Bandada\Notification\UseCases\Ports\PushResult;
use Bandada\Notification\UseCases\Ports\PushSender;
use Bandada\Notification\UseCases\Ports\RenderedMessage;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;
use Psr\Http\Client\ClientInterface;

/**
 * Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291), via minishlink/web-push.
 * Only handles `WEB` devices that registered a PushSubscription. Subscriptions the push service reports gone (404/410)
 * are returned in `invalidTokens` so the caller deletes them.
 */
final readonly class WebPushSender implements PushSender
{
    public function __construct(
        private string $subject,
        private string $publicKey,
        private string $privateKey,
        private int $ttlSeconds = 86400,
        private ?ClientInterface $client = null,
    ) {}

    public function send(array $devices, RenderedMessage $message, array $data): PushResult
    {
        $targets = array_values(array_filter($devices, static fn ($d): bool => $d->platform === DevicePlatform::Web && $d->webPush !== null));
        if ($targets === []) {
            return new PushResult(false);
        }

        $webPush = new WebPush(
            ['VAPID' => ['subject' => $this->subject, 'publicKey' => $this->publicKey, 'privateKey' => $this->privateKey]],
            ['TTL' => $this->ttlSeconds],
            $this->client,
        );
        $payload = json_encode(['title' => $message->title, 'body' => $message->body, 'data' => (object) $data], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
        $byEndpoint = [];
        foreach ($targets as $device) {
            $sub = $device->webPush;
            if ($sub === null) {
                continue;
            }
            $byEndpoint[$sub->endpoint] = $device->token;
            $webPush->queueNotification(new Subscription($sub->endpoint, $sub->p256dh, $sub->auth, 'aes128gcm'), $payload);
        }

        $delivered = false;
        $invalid = [];
        foreach ($webPush->flush() as $report) {
            if ($report->isSuccess()) {
                $delivered = true;
            } elseif ($report->isSubscriptionExpired() && isset($byEndpoint[$report->getEndpoint()])) {
                $invalid[] = $byEndpoint[$report->getEndpoint()];
            }
        }

        return new PushResult($delivered, $invalid);
    }
}
