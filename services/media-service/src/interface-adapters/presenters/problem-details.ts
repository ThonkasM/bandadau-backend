import { createProblem, type FieldError, type ProblemDetails } from '@bandada/contracts-ts/problem';
import { errorMessage } from '@bandada/i18n';

import type { DomainErrorCode } from '../../entities/errors/domain-error';

export type Locale = 'es' | 'en';

/** HTTP status of each business error code (contract-first: see the `responses` of every operation). */
export const DOMAIN_STATUS: Record<DomainErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  VALIDATION_FAILED: 400,
  UNSUPPORTED_MEDIA_TYPE: 422,
  MEDIA_TOO_LARGE: 422,
  VIDEO_TOO_LONG: 422,
  UPLOAD_MISSING: 422,
  UPLOAD_MISMATCH: 422,
  UPLOAD_EXPIRED: 422,
  MEDIA_NOT_FLAGGED: 409,
  SERVICE_UNAVAILABLE: 503,
};

const TITLES: Record<number, Record<Locale, string>> = {
  400: { es: 'Datos inválidos', en: 'Invalid data' },
  401: { es: 'No autenticado', en: 'Unauthenticated' },
  403: { es: 'Acceso denegado', en: 'Access denied' },
  404: { es: 'Recurso no encontrado', en: 'Resource not found' },
  405: { es: 'Método no permitido', en: 'Method not allowed' },
  409: { es: 'Conflicto', en: 'Conflict' },
  413: { es: 'Petición demasiado grande', en: 'Payload too large' },
  422: { es: 'Regla de negocio incumplida', en: 'Business rule violated' },
  429: { es: 'Demasiadas peticiones', en: 'Too many requests' },
  500: { es: 'Error interno', en: 'Internal error' },
  503: { es: 'Servicio no disponible', en: 'Service unavailable' },
};

/** Minimal ICU: `{name}` and `{name, plural, one {...} other {...}}` (with `#`), enough for the shared catalogs. */
export function formatIcu(message: string, params: Record<string, unknown> = {}): string {
  return message
    .replace(/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g, (_m, name: string, one: string, other: string) => {
      const value = Number(params[name]);
      return (value === 1 ? one : other).replace('#', String(params[name] ?? ''));
    })
    .replace(/\{(\w+)\}/g, (m, name: string) => (params[name] === undefined ? m : String(params[name])));
}

export const text = (code: string, locale: Locale, params?: Record<string, unknown>): string => formatIcu(errorMessage(code, locale), params);

export interface BuildProblemInput {
  status: number;
  code: string;
  locale: Locale;
  instance?: string;
  traceId?: string;
  errors?: Array<Pick<FieldError, 'field' | 'pointer' | 'code'> & { params?: Record<string, unknown> }>;
  params?: Record<string, unknown>;
  retryAfter?: number;
}

export function buildProblem(input: BuildProblemInput): ProblemDetails {
  const titles = TITLES[input.status] ?? TITLES[500]!;
  return createProblem({
    status: input.status,
    code: input.code,
    title: titles[input.locale],
    detail: text(input.code, input.locale, input.params),
    ...(input.instance ? { instance: input.instance } : {}),
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.errors
      ? { errors: input.errors.map((e) => ({ field: e.field, ...(e.pointer ? { pointer: e.pointer } : {}), code: e.code, message: text(e.code, input.locale, e.params) })) }
      : {}),
  });
}

/** Storable form of a DomainError for the idempotency store (re-localized on replay by the filter). */
export function domainErrorBody(error: { code: DomainErrorCode; meta: Record<string, unknown> }): { status: number; body: Record<string, unknown> } {
  const status = DOMAIN_STATUS[error.code];
  const field = error.meta.field as string | undefined;
  return {
    status,
    body: {
      code: error.code,
      ...(error.code === 'VALIDATION_FAILED' && field ? { errors: [{ field, pointer: `/${field}`, code: String(error.meta.code ?? 'INVALID_VALUE') }] } : {}),
    },
  };
}
