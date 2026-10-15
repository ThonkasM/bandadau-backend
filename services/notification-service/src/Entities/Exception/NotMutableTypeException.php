<?php

declare(strict_types=1);

namespace Bandada\Notification\Entities\Exception;

final class NotMutableTypeException extends DomainException
{
    public function __construct(public readonly string $type)
    {
        parent::__construct("Notification type {$type} cannot be muted");
    }

    public function errorCode(): string
    {
        return 'TYPE_NOT_MUTABLE';
    }

    public function params(): array
    {
        return ['type' => $this->type];
    }
}
