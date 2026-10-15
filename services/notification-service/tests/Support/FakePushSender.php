<?php

declare(strict_types=1);

namespace Tests\Support;

use Bandada\Notification\Entities\DeviceToken;
use Bandada\Notification\UseCases\Ports\PushResult;
use Bandada\Notification\UseCases\Ports\PushSender;
use Bandada\Notification\UseCases\Ports\RenderedMessage;

final class FakePushSender implements PushSender
{
    /** @var list<array{tokens: list<string>, title: string, data: array<string, string>}> */
    public array $sent = [];

    public bool $fails = false;

    /** @var list<string> */
    public array $invalidTokens = [];

    public function send(array $devices, RenderedMessage $message, array $data): PushResult
    {
        if ($this->fails) {
            throw new \RuntimeException('expo down');
        }
        $this->sent[] = ['tokens' => array_map(static fn (DeviceToken $d): string => $d->token, $devices), 'title' => $message->title, 'data' => $data];

        return new PushResult(true, $this->invalidTokens);
    }
}
