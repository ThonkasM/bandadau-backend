<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Http\Security;

final readonly class Principal
{
    /**
     * @param  list<string>  $roles
     * @param  list<string>  $scopes
     */
    public function __construct(
        public string $subject,
        public string $type,
        public array $roles,
        public array $scopes,
        public ?string $locale,
    ) {}

    public function isService(): bool
    {
        return $this->type === 'service';
    }
}
