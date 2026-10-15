<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Http\Problem;

use RuntimeException;

/** HTTP-level failure rendered as RFC 9457 Problem Details with a stable `code`. */
final class ProblemException extends RuntimeException
{
    /**
     * @param  array<string, scalar|null>  $params  values for the localized detail
     * @param  list<array{field:string,pointer:string,code:string,message:string}>  $errors
     * @param  array<string, string>  $headers
     */
    public function __construct(
        public readonly string $problemCode,
        public readonly array $params = [],
        public readonly array $errors = [],
        public readonly array $headers = [],
    ) {
        parent::__construct($problemCode);
    }

    /** @param list<array{field:string,pointer:string,code:string,message:string}> $errors */
    public static function validation(array $errors): self
    {
        return new self('VALIDATION_FAILED', [], $errors);
    }
}
