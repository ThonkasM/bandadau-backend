<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Gateways\Smtp;

use Bandada\Notification\Entities\Locale;
use Bandada\Notification\UseCases\Ports\EmailSender;
use Bandada\Notification\UseCases\Ports\RenderedMessage;
use Illuminate\Contracts\Mail\Mailer;

/** Laravel Mailer over SMTP (Mailpit in dev). Light theme only (D13); never includes post content. */
final readonly class SmtpEmailSender implements EmailSender
{
    public function __construct(private Mailer $mailer) {}

    public function send(string $to, RenderedMessage $message, Locale $locale, ?string $link): void
    {
        $data = [
            'title' => $message->title,
            'body' => $message->body,
            'link' => $link,
            'cta' => (string) __('emails.cta', [], $locale->value),
            'footer' => (string) __('emails.footer', [], $locale->value),
            'lang' => $locale->value,
        ];
        $this->mailer->send(['html' => 'mail.notification', 'text' => 'mail.notification-text'], $data, static function ($mail) use ($to, $message): void {
            $mail->to($to)->subject($message->title);
        });
    }
}
