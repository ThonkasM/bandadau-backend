<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Http\Middleware;

use Bandada\Wallet\Adapter\In\Http\Problem\ProblemException;
use Bandada\Wallet\Adapter\In\Http\Security\Principal;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Alias `role:STUDENT,ADMIN`: the user must hold at least one of the listed roles. */
final class RequireRole
{
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $principal = $request->attributes->get('principal');
        if (! $principal instanceof Principal || array_intersect($roles, $principal->roles) === []) {
            throw new ProblemException('FORBIDDEN');
        }

        return $next($request);
    }
}
