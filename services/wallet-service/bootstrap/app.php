<?php

use Bandada\Wallet\Adapter\In\Http\Middleware\AuthenticateJwt;
use Bandada\Wallet\Adapter\In\Http\Middleware\EnsureIdempotency;
use Bandada\Wallet\Adapter\In\Http\Middleware\RequestContext;
use Bandada\Wallet\Adapter\In\Http\Middleware\RequireRole;
use Bandada\Wallet\Adapter\In\Http\Problem\ProblemDetailsRenderer;
use Bandada\Wallet\Adapter\In\Http\Problem\ProblemException;
use Bandada\Wallet\Domain\Exception\DomainException;
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
        $exceptions->dontReport([
            DomainException::class,
            ProblemException::class,
        ]);
    })->create();
