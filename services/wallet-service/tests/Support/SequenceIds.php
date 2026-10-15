<?php

declare(strict_types=1);

namespace Tests\Support;

use Bandada\Wallet\Application\Port\Out\IdGenerator;

final class SequenceIds implements IdGenerator
{
    private int $n = 0;

    public function next(): string
    {
        $this->n++;

        return sprintf('00000000-0000-7000-8000-%012d', $this->n);
    }
}
