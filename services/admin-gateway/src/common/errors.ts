import { GraphQLError } from 'graphql';

export interface Problem {
  code?: string;
  title?: string;
  detail?: string;
  status?: number;
  errors?: { field?: string; code?: string; message?: string }[];
  [key: string]: unknown;
}

/** Non-2xx answer (or transport failure, `status = 0`) of a downstream service. */
export class ServiceHttpError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    readonly problem: Problem | undefined,
    message?: string,
  ) {
    super(message ?? problem?.detail ?? problem?.title ?? `${service} answered ${status}`);
    this.name = 'ServiceHttpError';
  }

  get code(): string {
    if (this.problem?.code) return this.problem.code;
    if (this.status === 404) return 'NOT_FOUND';
    if (this.status === 0 || this.status === 503 || this.status === 504) return 'SERVICE_UNAVAILABLE';
    return 'DOWNSTREAM_ERROR';
  }
}

export function gqlError(code: string, message: string, extra: Record<string, unknown> = {}): GraphQLError {
  return new GraphQLError(message, { extensions: { code, ...extra } });
}

export const unauthenticated = () => gqlError('UNAUTHENTICATED', 'Authentication required');
export const forbidden = () => gqlError('FORBIDDEN', 'Insufficient permissions');
export const featureDisabled = (feature: string) =>
  gqlError('FEATURE_DISABLED', `${feature} is not available in phase 1`, { feature });

export interface UserError {
  code: string;
  message: string;
  field?: string[] | null;
}

/** Business failures (4xx with a Problem `code`) become `errors[]` of a mutation payload; anything else is rethrown. */
export function toUserErrors(error: unknown): UserError[] {
  if (error instanceof ServiceHttpError && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 403) {
    const field = error.problem?.errors?.[0]?.field;
    return [{ code: error.code, message: error.message, field: field ? field.replace(/^\//, '').split('/') : null }];
  }
  throw error;
}

const GUARD_MESSAGES: Record<string, { es: string; en: string }> = {
  CANNOT_DEMOTE_SELF: { es: 'No puedes quitarte tu propio rol de administrador.', en: 'You cannot remove your own administrator role.' },
  CANNOT_SUSPEND_SELF: { es: 'No puedes suspender tu propia cuenta.', en: 'You cannot suspend your own account.' },
  ROLES_REQUIRED: { es: 'El usuario debe conservar al menos un rol.', en: 'The user must keep at least one role.' },
  ALREADY_MODERATED: { es: 'Otro moderador ya resolvió este contenido.', en: 'Another moderator already resolved this content.' },
};

/** Gateway-side safeguards (the origin services do not know about the acting panel user). */
export function selfGuardError(code: keyof typeof GUARD_MESSAGES, locale: string, field?: string[]): UserError {
  const m = GUARD_MESSAGES[code]!;
  return { code, message: locale === 'en' ? m.en : m.es, field: field ?? null };
}

/** `MEDIA_NOT_FLAGGED` (media-service) is exposed to the panel as `ALREADY_MODERATED`. */
export function mapMediaModerationErrors(errors: UserError[], locale: string): UserError[] {
  return errors.map((e) => (e.code === 'MEDIA_NOT_FLAGGED' ? { ...selfGuardError('ALREADY_MODERATED', locale), field: e.field } : e));
}
