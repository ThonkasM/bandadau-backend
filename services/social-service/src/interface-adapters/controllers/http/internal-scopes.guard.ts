import { type RequestWithPrincipal } from '@bandada/auth-ts/nest';
import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

export const INTERNAL_SCOPES_OPTIONS = Symbol('InternalScopesOptions');
export interface InternalScopesOptions {
  enforced: boolean;
}

export const INTERNAL_READ_SCOPE = 'internal:read';
export const INTERNAL_WRITE_SCOPE = 'internal:write';

/**
 * Fine-grained service-to-service authorization (D-7, seguridad-y-sso.md §2.1): `GET`/`HEAD` need `internal:read`, everything else `internal:write`.
 * Must run after `ServiceAuthGuard` (which verifies the token and sets `request.user`).
 */
@Injectable()
export class InternalScopesGuard implements CanActivate {
  constructor(@Inject(INTERNAL_SCOPES_OPTIONS) private readonly options: InternalScopesOptions) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.options.enforced) return true;
    const req = context.switchToHttp().getRequest<Request & RequestWithPrincipal>();
    const required = req.method === 'GET' || req.method === 'HEAD' ? INTERNAL_READ_SCOPE : INTERNAL_WRITE_SCOPE;
    if (!req.user?.scopes.includes(required)) throw new ForbiddenException({ code: 'FORBIDDEN' });
    return true;
  }
}
