<?php

declare(strict_types=1);

namespace Bandada\Wallet\Application\Port\Out;

interface TransactionManager
{
    /**
     * @template T
     *
     * @param  callable(): T  $work
     * @return T
     */
    public function run(callable $work): mixed;
}
