<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Controllers\Http;

use Bandada\Notification\InterfaceAdapters\Controllers\Http\Problem\ProblemException;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Security\Principal;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Support\RequestValidator;
use Bandada\Notification\InterfaceAdapters\Presenters\Presenter;
use Bandada\Notification\InterfaceAdapters\Shared\Support\Timestamps;
use Bandada\Notification\UseCases\Inbox\ListNotifications;
use Bandada\Notification\UseCases\Inbox\MarkAllAsRead;
use Bandada\Notification\UseCases\Inbox\MarkAsRead;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

final readonly class NotificationController
{
    public function __construct(
        private ListNotifications $list,
        private MarkAsRead $markAsRead,
        private MarkAllAsRead $markAllAsRead,
    ) {}

    /** listNotifications */
    public function index(Request $request): JsonResponse
    {
        $params = RequestValidator::validate($request->query(), [
            'cursor' => ['sometimes', 'string', 'max:512'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:50'],
            'unreadOnly' => ['sometimes', 'in:true,false,1,0'],
        ]);
        $unreadOnly = in_array($params['unreadOnly'] ?? 'false', ['true', '1'], true);

        $page = $this->list->execute(
            $this->principal($request)->subject,
            (int) ($params['limit'] ?? 20),
            isset($params['cursor']) ? $this->decodeCursor((string) $params['cursor']) : null,
            $unreadOnly,
        );

        return new JsonResponse([
            'items' => array_map(Presenter::notification(...), $page['items']),
            'nextCursor' => $page['nextAfterId'] === null ? null : $this->encodeCursor($page['nextAfterId']),
        ], 200, ['X-Unread-Count' => (string) $page['unreadCount']]);
    }

    /** markNotificationRead */
    public function read(Request $request, string $notificationId): JsonResponse
    {
        RequestValidator::validate(['notificationId' => $notificationId], ['notificationId' => ['required', 'uuid']]);

        return new JsonResponse(Presenter::notification($this->markAsRead->execute($this->principal($request)->subject, strtolower($notificationId))));
    }

    /** markAllNotificationsRead */
    public function readAll(Request $request): JsonResponse
    {
        $result = $this->markAllAsRead->execute($this->principal($request)->subject);

        return new JsonResponse(['updatedCount' => $result['updatedCount'], 'readAt' => Timestamps::toApi($result['readAt'])]);
    }

    private function encodeCursor(string $id): string
    {
        return rtrim(strtr(base64_encode(json_encode(['sk' => 'NOTIF#'.$id], JSON_THROW_ON_ERROR)), '+/', '-_'), '=');
    }

    private function decodeCursor(string $token): string
    {
        try {
            $json = base64_decode(strtr($token, '-_', '+/'), true);
            $data = $json === false ? null : json_decode($json, true, 4, JSON_THROW_ON_ERROR);
            $sk = is_array($data) ? ($data['sk'] ?? null) : null;
            if (is_string($sk) && preg_match('/^NOTIF#([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/', $sk, $m) === 1) {
                return $m[1];
            }
        } catch (Throwable) {
        }

        throw new ProblemException('INVALID_CURSOR');
    }

    private function principal(Request $request): Principal
    {
        /** @var Principal $principal */
        $principal = $request->attributes->get('principal');

        return $principal;
    }
}
