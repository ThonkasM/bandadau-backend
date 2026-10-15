<?php

namespace App\Console\Commands;

use App\Support\EnvironmentValidator;
use Illuminate\Console\Command;

class CheckEnvCommand extends Command
{
    protected $signature = 'bandada:check-env';

    protected $description = 'Validate the environment configuration and exit non-zero when it is invalid';

    public function handle(): int
    {
        $problems = EnvironmentValidator::problems();
        foreach ($problems as $problem) {
            $this->error($problem);
        }

        return $problems === [] ? self::SUCCESS : self::FAILURE;
    }
}
