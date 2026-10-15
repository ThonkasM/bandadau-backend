<?php

declare(strict_types=1);

namespace Bandada\Notification\InterfaceAdapters\Shared\Process;

/** Liveness marker for long-running workers; the container HEALTHCHECK reads its mtime. */
final class Heartbeat
{
    public static function beat(): void
    {
        @touch(self::path());
    }

    public static function path(): string
    {
        return (string) (getenv('BANDADA_HEARTBEAT_FILE') ?: sys_get_temp_dir().'/bandada-heartbeat');
    }
}
