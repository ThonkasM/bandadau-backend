<?php

$origins = array_values(array_filter(array_map('trim', explode(',', (string) env('CORS_ORIGINS', '')))));

$patterns = [];
$exact = [];
foreach ($origins as $origin) {
    if (str_contains($origin, '*')) {
        $patterns[] = '#^'.str_replace('\*', '[a-z0-9.-]+', preg_quote($origin, '#')).'$#i';
    } else {
        $exact[] = $origin;
    }
}

return [
    'paths' => ['api/*', 'internal/*'],
    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    'allowed_origins' => $exact,
    'allowed_origins_patterns' => $patterns,
    'allowed_headers' => [
        'Authorization', 'Content-Type', 'Idempotency-Key', 'X-Correlation-Id',
        'traceparent', 'tracestate', 'Accept-Language', 'If-Match', 'If-None-Match',
    ],
    'exposed_headers' => [
        'Location', 'ETag', 'Retry-After', 'Idempotent-Replayed', 'X-Correlation-Id', 'Content-Language',
    ],
    'max_age' => 600,
    'supports_credentials' => false,
];
