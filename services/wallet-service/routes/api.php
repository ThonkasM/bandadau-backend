<?php

use Bandada\Wallet\Adapter\In\Http\Controllers\HealthController;
use Bandada\Wallet\Adapter\In\Http\Controllers\InternalStatsController;
use Bandada\Wallet\Adapter\In\Http\Controllers\PaymentWebhookController;
use Bandada\Wallet\Adapter\In\Http\Controllers\TopUpController;
use Bandada\Wallet\Adapter\In\Http\Controllers\WalletController;
use Illuminate\Support\Facades\Route;

Route::get('health/live', [HealthController::class, 'live']);
Route::get('health/ready', [HealthController::class, 'ready']);

Route::prefix('api/v1/wallet')->group(function (): void {
    Route::middleware(['auth.jwt', 'role:STUDENT,ORGANIZER,MODERATOR,ADMIN'])->group(function (): void {
        Route::get('me', [WalletController::class, 'show']);
        Route::get('me/entries', [WalletController::class, 'entries']);
        Route::post('topups', [TopUpController::class, 'store'])->middleware('idempotent');
        Route::get('topups/{topUpId}', [TopUpController::class, 'show']);
        Route::post('topups/{topUpId}/simulate-payment', [TopUpController::class, 'simulate']);
    });

    // No JWT: authenticity comes from the HMAC signature of the raw body.
    Route::post('webhooks/payment', PaymentWebhookController::class);
});

Route::prefix('internal/v1')->middleware('auth.jwt:service,internal:read')->group(function (): void {
    Route::get('stats/credits', InternalStatsController::class);
});
