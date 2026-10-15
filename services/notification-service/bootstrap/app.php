<?php

use Bandada\Notification\Entities\Exception\DomainException;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Middleware\AuthenticateJwt;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Middleware\EnsureIdempotency;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Middleware\RequestContext;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Middleware\RequireRole;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Problem\ProblemDetailsRenderer;
use Bandada\Notification\InterfaceAdapters\Controllers\Http\Problem\ProblemException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        apiPrefix: '',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->prepend(RequestContext::class);
        $middleware->alias([
            'auth.jwt' => AuthenticateJwt::class,
            'role' => RequireRole::class,
            'idempotent' => EnsureIdempotency::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Every failure leaves the service as RFC 9457 Problem Details (localized, stable `code`).
        $exceptions->shouldRenderJsonWhen(static fn (): bool => true);
        $exceptions->render(
            static fn (Throwable $e, Request $request) => app(ProblemDetailsRenderer::class)->render($e, $request),
        );
        $exceptions->dontReport([DomainException::class, ProblemException::class]);
    })->create();
