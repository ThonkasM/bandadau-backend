<?php

declare(strict_types=1);

namespace Bandada\Notification\UseCases\Inbox;

use Bandada\Notification\UseCases\Ports\NotificationRepository;
use Bandada\Notification\UseCases\Ports\TemplateRenderer;

final readonly class ListNotifications
{
    public function __construct(private NotificationRepository $notifications, private TemplateRenderer $templates) {}

    /** @return array{items: list<NotificationView>, nextAfterId: ?string, unreadCount: int} */
    public function execute(string $userId, int $limit, ?string $afterId, bool $unreadOnly): array
    {
        $rows = $this->notifications->page($userId, $limit + 1, $afterId, $unreadOnly);
        $hasMore = count($rows) > $limit;
        $rows = array_slice($rows, 0, $limit);
        $views = array_map(function ($n): NotificationView {
            $message = $this->templates->render($n->type, $n->params, $n->locale);

            return new NotificationView($n, $message->title, $message->body);
        }, $rows);
        $last = $rows === [] ? null : $rows[array_key_last($rows)];

        return [
            'items' => $views,
            'nextAfterId' => $hasMore && $last !== null ? $last->id : null,
            'unreadCount' => $this->notifications->unreadCount($userId),
        ];
    }
}
