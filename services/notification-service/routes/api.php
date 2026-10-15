<?php

use Bandada\Notification\InterfaceAdapters\Controllers\Http\DeviceController;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\HealthController;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\InternalNotificationController;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\NotificationController;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\PreferencesController;
use Illuminate\Support\Facades\Route;

Route::get('health/live', [HealthController::class, 'live']);
Route::get('health/ready', [HealthController::class, 'ready']);

Route::prefix('api/v1')->middleware(['auth.jwt', 'role:STUDENT,ORGANIZER,MODERATOR,ADMIN'])->group(function (): void {
    Route::get('notifications', [NotificationController::class, 'index']);
    Route::post('notifications/read-all', [NotificationController::class, 'readAll']);
    Route::get('notifications/preferences', [PreferencesController::class, 'show']);
    Route::put('notifications/preferences', [PreferencesController::class, 'replace']);
    Route::post('notifications/{notificationId}/read', [NotificationController::class, 'read']);
    Route::put('devices/{token}', [DeviceController::class, 'register'])->where('token', '.+');
    Route::delete('devices/{token}', [DeviceController::class, 'unregister'])->where('token', '.+');
});

Route::prefix('internal/v1')->middleware('auth.jwt:service,internal:write')->group(function (): void {
    Route::post('notifications', InternalNotificationController::class)->middleware('idempotent');
});
