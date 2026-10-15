<?php

return [
    'VALIDATION_FAILED' => ['title' => 'Invalid data', 'detail' => 'One or more fields do not meet the rules.'],
    'MALFORMED_REQUEST' => ['title' => 'Malformed request', 'detail' => 'The request body is not valid JSON.'],
    'INVALID_CURSOR' => ['title' => 'Invalid cursor', 'detail' => 'The pagination cursor is invalid or was tampered with.'],
    'IDEMPOTENCY_KEY_REQUIRED' => ['title' => 'Idempotency key required', 'detail' => 'This operation requires the Idempotency-Key header.'],
    'IDEMPOTENCY_KEY_INVALID' => ['title' => 'Invalid idempotency key', 'detail' => 'The Idempotency-Key header must be a UUID.'],
    'UNAUTHORIZED' => ['title' => 'Not authenticated', 'detail' => 'The access token is invalid or has expired. Please sign in again.'],
    'FORBIDDEN' => ['title' => 'Access denied', 'detail' => 'You do not have permission to perform this operation.'],
    'NOT_FOUND' => ['title' => 'Resource not found', 'detail' => 'The requested resource does not exist.'],
    'NOTIFICATION_NOT_FOUND' => ['title' => 'Notification not found', 'detail' => 'There is no notification with the given identifier.'],
    'METHOD_NOT_ALLOWED' => ['title' => 'Method not allowed', 'detail' => 'The HTTP method is not allowed for this resource.'],
    'UNSUPPORTED_MEDIA_TYPE' => ['title' => 'Unsupported media type', 'detail' => 'The request content type is not supported.'],
    'CONFLICT' => ['title' => 'Conflict', 'detail' => 'The operation conflicts with the current state of the resource.'],
    'IDEMPOTENCY_IN_PROGRESS' => ['title' => 'Request in progress', 'detail' => 'A request with this Idempotency-Key is already being processed. Retry in a few seconds.'],
    'IDEMPOTENCY_KEY_REUSED' => ['title' => 'Idempotency key reused', 'detail' => 'The Idempotency-Key was already used with a different request. Generate a new key.'],
    'TYPE_NOT_MUTABLE' => ['title' => 'Type cannot be muted', 'detail' => 'Notifications of type :type cannot be muted.'],
    'INVALID_DEVICE_TOKEN' => ['title' => 'Invalid device token', 'detail' => 'The device token must have between 8 and 512 characters.'],
    'RATE_LIMITED' => ['title' => 'Too many requests', 'detail' => 'You have made too many requests. Please try again later.'],
    'INTERNAL_ERROR' => ['title' => 'Internal error', 'detail' => 'An unexpected error occurred. We are looking into it.'],
    'DEPENDENCY_UNAVAILABLE' => ['title' => 'Service unavailable', 'detail' => 'A dependency is temporarily unavailable. Please try again later.'],
];
