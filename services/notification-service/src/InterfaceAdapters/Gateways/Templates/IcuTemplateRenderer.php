<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Gateways\Templates;

use Bandada\Notification\Entities\Locale;
use Bandada\Notification\Entities\NotificationType;
use Bandada\Notification\UseCases\Ports\RenderedMessage;
use Bandada\Notification\UseCases\Ports\TemplateRenderer;
use DateTimeImmutable;
use Illuminate\Support\Facades\Lang;
use IntlDateFormatter;
use MessageFormatter;
use Throwable;

/** ICU MessageFormat templates in lang/{es,en}/notifications.php; falls back to `es` (D14). */
final readonly class IcuTemplateRenderer implements TemplateRenderer
{
    public function __construct(private string $displayTimezone = 'America/La_Paz') {}

    public function render(NotificationType $type, array $params, Locale $locale): RenderedMessage
    {
        $fallback = false;
        $resolved = $locale;
        if (! Lang::has("notifications.{$type->value}.title", $locale->value, false)) {
            $resolved = Locale::Es;
            $fallback = true;
        }
        $title = $this->format("notifications.{$type->value}.title", $params, $resolved);
        $body = $this->format("notifications.{$type->value}.body", $params, $resolved);

        return new RenderedMessage($title, $body, $fallback);
    }

    /** @param array<string, mixed> $params */
    private function format(string $key, array $params, Locale $locale): string
    {
        $pattern = (string) Lang::get($key, [], $locale->value, false);
        $args = $this->arguments($pattern, $params, $locale);
        try {
            $formatted = MessageFormatter::formatMessage($locale === Locale::Es ? 'es_BO' : 'en_US', $pattern, $args);
        } catch (Throwable) {
            $formatted = false;
        }

        return $formatted === false ? $pattern : $formatted;
    }

    /**
     * @param  array<string, mixed>  $params
     * @return array<string, mixed>
     */
    private function arguments(string $pattern, array $params, Locale $locale): array
    {
        $args = [];
        foreach ($params as $name => $value) {
            if (is_scalar($value)) {
                $args[$name] = $value;
                if (is_string($value) && str_ends_with($name, 'At') && $this->isIsoDate($value)) {
                    $args[$name.'Text'] = $this->formatDate($value, $locale);
                }
            }
        }
        preg_match_all('/\{\s*([A-Za-z_][A-Za-z0-9_]*)/', $pattern, $m);
        foreach ($m[1] as $placeholder) {
            $args[$placeholder] ??= '';
        }

        return $args;
    }

    private function isIsoDate(string $value): bool
    {
        return preg_match('/^\d{4}-\d{2}-\d{2}T/', $value) === 1;
    }

    private function formatDate(string $iso, Locale $locale): string
    {
        try {
            $formatter = new IntlDateFormatter(
                $locale === Locale::Es ? 'es_BO' : 'en_US', IntlDateFormatter::MEDIUM, IntlDateFormatter::SHORT, $this->displayTimezone,
            );

            return (string) $formatter->format(new DateTimeImmutable($iso));
        } catch (Throwable) {
            return $iso;
        }
    }
}
