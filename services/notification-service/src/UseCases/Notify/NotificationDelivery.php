<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Notify;

use Bandada\Notification\Entities\Channel;
use Bandada\Notification\Entities\DeliveryStatus;
use Bandada\Notification\Entities\Notification;
use Bandada\Notification\Entities\NotificationPreference;
use Bandada\Notification\UseCases\Ports\DeviceRepository;
use Bandada\Notification\UseCases\Ports\EmailSender;
use Bandada\Notification\UseCases\Ports\NotificationRepository;
use Bandada\Notification\UseCases\Ports\PushSender;
use Bandada\Notification\UseCases\Ports\RenderedMessage;
use Bandada\Notification\UseCases\Ports\TemplateRenderer;
use Throwable;

/** Pushes and emails a committed notification. In-app is the source of truth: failures here never throw. */
final readonly class NotificationDelivery
{
    public function __construct(
        private NotificationRepository $notifications,
        private DeviceRepository $devices,
        private PushSender $push,
        private EmailSender $email,
        private TemplateRenderer $templates,
        private NotificationSettings $settings,
    ) {}

    /**
     * @param  list<Channel>  $channels
     * @return array{0: DeliveryStatus, 1: DeliveryStatus}
     */
    public function initialStatuses(array $channels, NotificationPreference $pref): array
    {
        $push = in_array(Channel::Push, $channels, true)
            ? ($this->settings->pushEnabled ? DeliveryStatus::Pending : DeliveryStatus::Skipped)
            : DeliveryStatus::None;
        $email = in_array(Channel::Email, $channels, true)
            ? ($this->settings->emailEnabled && $pref->email !== null ? DeliveryStatus::Pending : DeliveryStatus::Skipped)
            : DeliveryStatus::None;

        return [$push, $email];
    }

    /** Delivers whatever is still PENDING and persists the outcome (also used to resume after a crash). */
    public function deliver(Notification $n, NotificationPreference $pref): void
    {
        $push = $n->pushStatus();
        $email = $n->emailStatus();
        if ($push === DeliveryStatus::Pending || $email === DeliveryStatus::Pending) {
            $message = $this->templates->render($n->type, $n->params, $n->locale);
            if ($push === DeliveryStatus::Pending) {
                $push = $this->sendPush($n, $message);
            }
            if ($email === DeliveryStatus::Pending) {
                $email = $this->sendEmail($n, $pref, $message);
            }
            $n->withDelivery($push, $email);
            if ($n->stored) {
                try {
                    $this->notifications->updateDelivery($n);
                } catch (Throwable) {
                    // the in-app item exists; the status is best effort
                }
            }
        }
    }

    private function sendPush(Notification $n, RenderedMessage $message): DeliveryStatus
    {
        try {
            $devices = $this->devices->forUser($n->userId);
            if ($devices === []) {
                return DeliveryStatus::Skipped;
            }
            $data = $n->data + ['type' => $n->type->value];
            if ($n->stored) {
                $data['notificationId'] = $n->id;
            }
            $result = $this->push->send($devices, $message, $data);
            foreach ($result->invalidTokens as $token) {
                $this->devices->remove($n->userId, $token);
            }

            return $result->delivered ? DeliveryStatus::Sent : DeliveryStatus::Failed;
        } catch (Throwable) {
            return DeliveryStatus::Failed;
        }
    }

    private function sendEmail(Notification $n, NotificationPreference $pref, RenderedMessage $message): DeliveryStatus
    {
        if ($pref->email === null) {
            return DeliveryStatus::Skipped;
        }
        $backoffs = $this->settings->emailBackoffMs;
        for ($attempt = 0; $attempt <= count($backoffs); $attempt++) {
            try {
                $this->email->send($pref->email, $message, $n->locale, $n->deepLink());

                return DeliveryStatus::Sent;
            } catch (Throwable) {
                if (isset($backoffs[$attempt])) {
                    usleep($backoffs[$attempt] * 1000);
                }
            }
        }

        return DeliveryStatus::Failed;
    }
}
