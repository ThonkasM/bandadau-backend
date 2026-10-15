<?php

namespace App\Logging;

use Bandada\Notification\InterfaceAdapters\Shared\Logging\LogContext;
use Monolog\LogRecord;
use Monolog\Processor\ProcessorInterface;

class LogContextProcessor implements ProcessorInterface
{
    public function __invoke(LogRecord $record): LogRecord
    {
        $record->extra['service'] = 'notification-service';
        $record->extra['correlationId'] = LogContext::correlationId();
        $record->extra['traceId'] = LogContext::traceId();
        $record->extra['userId'] = LogContext::userId();

        return $record;
    }
}
