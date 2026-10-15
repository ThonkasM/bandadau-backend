<?php

namespace App\Logging;

use Monolog\Formatter\NormalizerFormatter;
use Monolog\LogRecord;

/** One JSON object per line: timestamp, level, service, correlationId, traceId, userId, event, message + context. */
class JsonLogFormatter extends NormalizerFormatter
{
    public function __construct()
    {
        parent::__construct('Y-m-d\TH:i:s.v\Z');
    }

    public function format(LogRecord $record): string
    {
        $extra = $this->normalize($record->extra);
        $context = $this->normalize($record->context);
        $line = [
            'timestamp' => $record->datetime->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z'),
            'level' => strtolower($record->level->getName()),
            'service' => $extra['service'] ?? 'wallet-service',
            'traceId' => $extra['traceId'] ?? null,
            'correlationId' => $extra['correlationId'] ?? null,
            'userId' => $extra['userId'] ?? null,
            'event' => $context['event'] ?? null,
            'message' => $record->message,
        ];
        unset($context['event']);
        if ($context !== []) {
            $line['context'] = $context;
        }

        return json_encode($line, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR)."\n";
    }
}
