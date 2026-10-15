<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Ports;

use Bandada\Notification\Entities\Locale;
use Bandada\Notification\Entities\NotificationType;

interface TemplateRenderer
{
    /** @param array<string, mixed> $params ICU variables; falls back to `es` when a translation is missing */
    public function render(NotificationType $type, array $params, Locale $locale): RenderedMessage;
}
