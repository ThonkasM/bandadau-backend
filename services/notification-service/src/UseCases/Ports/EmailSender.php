<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Ports;

use Bandada\Notification\Entities\Locale;

interface EmailSender
{
    /** @throws \Throwable when the message could not be handed to the mail server */
    public function send(string $to, RenderedMessage $message, Locale $locale, ?string $link): void;
}
