<?php

namespace App\Logging;

use Bandada\Wallet\Adapter\Shared\Logging\LogContext;
use Monolog\LogRecord;
use Monolog\Processor\ProcessorInterface;

class LogContextProcessor implements ProcessorInterface
{
    public function __invoke(LogRecord $record): LogRecord
    {
        $record->extra['service'] = 'wallet-service';
        $record->extra['correlationId'] = LogContext::correlationId();
        $record->extra['traceId'] = LogContext::traceId();
        $record->extra['userId'] = LogContext::userId();

        return $record;
    }
}
