<?php

declare(strict_types=1);

namespace Tests\Support;

use Bandada\Notification\Entities\Locale;
use Bandada\Notification\Entities\Notification;
use Bandada\Notification\Entities\NotificationType;
use Bandada\Notification\UseCases\Ports\CommitRequest;
use Bandada\Notification\UseCases\Ports\NotificationRepository;
use Illuminate\Support\Str;

trait ApiHelpers
{
    protected function newUser(): string
    {
        return Str::uuid7()->toString();
    }

    /** @return array<string, string> */
    protected function auth(string $userId): array
    {
        return ['Authorization' => 'Bearer '.TestJwt::userToken($userId)];
    }

    /** @return array<string, string> */
    protected function service(string $scope = 'internal:write'): array
    {
        return ['Authorization' => 'Bearer '.TestJwt::serviceToken($scope)];
    }

    /** Stores a notification directly (bypasses the consumer) and returns it. */
    protected function seedNotification(string $userId, NotificationType $type = NotificationType::NewComment, array $params = [], string $locale = 'es'): Notification
    {
        $now = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        usleep(2000);
        $n = new Notification(Str::uuid7()->toString(), $userId, $type, $params, ['deepLink' => 'http://app.bandada.localhost/posts/1'], Locale::from($locale), $now, $now->modify('+90 days'));
        $this->app->make(NotificationRepository::class)->commit(new CommitRequest('seed:'.$n->id, 86400, false, [$n], [], [], $now));

        return $n;
    }
}
