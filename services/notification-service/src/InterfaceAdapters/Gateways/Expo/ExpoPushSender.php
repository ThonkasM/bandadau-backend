<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Gateways\Expo;

use Bandada\Notification\UseCases\Ports\PushResult;
use Bandada\Notification\UseCases\Ports\PushSender;
use Bandada\Notification\UseCases\Ports\RenderedMessage;
use Illuminate\Http\Client\Factory as Http;
use RuntimeException;

/** Expo Push API (https://docs.expo.dev/push-notifications/sending-notifications/): batches of up to 100. */
final readonly class ExpoPushSender implements PushSender
{
    public function __construct(private Http $http, private string $url, private string $accessToken, private int $chunkSize = 100) {}

    public function send(array $devices, RenderedMessage $message, array $data): PushResult
    {
        $delivered = false;
        $invalid = [];
        foreach (array_chunk($devices, max(1, min(100, $this->chunkSize))) as $chunk) {
            $payload = array_map(static fn ($d): array => [
                'to' => $d->token, 'title' => $message->title, 'body' => $message->body, 'data' => (object) $data, 'sound' => 'default',
            ], $chunk);
            $request = $this->http->timeout(10)->acceptJson()->retry(2, 300, throw: false);
            if ($this->accessToken !== '') {
                $request = $request->withToken($this->accessToken);
            }
            $response = $request->post($this->url, $payload);
            if (! $response->successful()) {
                throw new RuntimeException('Expo push responded HTTP '.$response->status());
            }
            $tickets = $response->json('data');
            foreach (is_array($tickets) ? array_values($tickets) : [] as $i => $ticket) {
                if (($ticket['status'] ?? null) === 'ok') {
                    $delivered = true;
                } elseif (($ticket['details']['error'] ?? null) === 'DeviceNotRegistered' && isset($chunk[$i])) {
                    $invalid[] = $chunk[$i]->token;
                }
            }
        }

        return new PushResult($delivered, $invalid);
    }
}
