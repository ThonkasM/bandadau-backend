<?php

declare(strict_types=1);

namespace Bandada\Wallet\Adapter\In\Http\Middleware;

use Bandada\Wallet\Adapter\In\Http\Problem\ProblemException;
use Bandada\Wallet\Adapter\In\Http\Security\JwtVerifier;
use Bandada\Wallet\Adapter\Shared\Logging\LogContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Alias `auth.jwt`: user access tokens (typ=user) for the app/admin audiences.
 * With `service` as parameter (`auth.jwt:service,internal:read`) it accepts only service tokens
 * (typ=service, internal audience, required scope) for /internal/v1.
 */
final readonly class AuthenticateJwt
{
    /**
     * @param  list<string>  $userAudiences
     */
    public function __construct(
        private JwtVerifier $verifier,
        private array $userAudiences,
        private string $internalAudience,
    ) {}

    public function handle(Request $request, Closure $next, string $mode = 'user', string $scope = ''): Response
    {
        $header = (string) $request->header('Authorization', '');
        if (preg_match('/^Bearer\s+(\S+)$/i', $header, $m) !== 1) {
            throw $this->unauthorized();
        }
        $verified = $this->verifier->verify($m[1]);
        if ($verified === null) {
            throw $this->unauthorized();
        }
        $principal = $verified['principal'];
        $audiences = (array) ($verified['claims']->aud ?? []);

        if ($mode === 'service') {
            if (! $principal->isService() || ! in_array($this->internalAudience, $audiences, true)) {
                throw new ProblemException('FORBIDDEN');
            }
            if ($scope !== '' && ! in_array($scope, $principal->scopes, true)) {
                throw new ProblemException('FORBIDDEN');
            }
        } else {
            if ($principal->type !== 'user' || array_intersect($this->userAudiences, $audiences) === []) {
                throw $this->unauthorized();
            }
            if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $principal->subject) !== 1) {
                throw $this->unauthorized();
            }
        }

        $request->attributes->set('principal', $principal);
        LogContext::setUser($principal->subject);

        return $next($request);
    }

    private function unauthorized(): ProblemException
    {
        return new ProblemException('UNAUTHORIZED', headers: ['WWW-Authenticate' => 'Bearer error="invalid_token"']);
    }
}
