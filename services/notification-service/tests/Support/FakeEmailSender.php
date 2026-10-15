<?php

declare(strict_types=1);

namespace Tests\Support;

use Bandada\Notification\Entities\Locale;
use Bandada\Notification\UseCases\Ports\EmailSender;
use Bandada\Notification\UseCases\Ports\RenderedMessage;

final class FakeEmailSender implements EmailSender
{
    /** @var list<array{to: string, title: string, body: string, locale: string, link: ?string}> */
    public array $sent = [];

    public int $failures = 0;

    public function send(string $to, RenderedMessage $message, Locale $locale, ?string $link): void
    {
        if ($this->failures > 0) {
            $this->failures--;
            throw new \RuntimeException('smtp down');
        }
        $this->sent[] = ['to' => $to, 'title' => $message->title, 'body' => $message->body, 'locale' => $locale->value, 'link' => $link];
    }
}
