import type { Locale } from '@bandada/i18n';

type Template = (params: Record<string, string>) => string;
interface Message {
  title: Record<Locale, string>;
  detail: Record<Locale, Template>;
}
const same = (es: string, en: string): Pick<Message, 'detail'> => ({ detail: { es: () => es, en: () => en } });

export const PROBLEM_STATUS: Record<string, number> = {
  REPORT_NOT_FOUND: 404,
  ALERT_NOT_FOUND: 404,
  AGENT_RUN_NOT_FOUND: 404,
  ALERT_ALREADY_RESOLVED: 409,
  VALIDATION_FAILED: 422,
  INVALID_CURSOR: 400,
  FORBIDDEN: 403,
  RATE_LIMITED: 429,
  LLM_UNAVAILABLE: 503,
  UPSTREAM_UNAVAILABLE: 503,
  AGENT_STEP_LIMIT: 422,
  NOT_FOUND: 404,
  MALFORMED_REQUEST: 400,
  METHOD_NOT_ALLOWED: 405,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export const PROBLEM_MESSAGES: Record<string, Message> = {
  REPORT_NOT_FOUND: { title: { es: 'Reporte no encontrado', en: 'Report not found' }, ...same('No existe un reporte con ese identificador.', 'There is no report with that identifier.') },
  ALERT_NOT_FOUND: { title: { es: 'Alerta no encontrada', en: 'Alert not found' }, ...same('No existe una alerta con ese identificador.', 'There is no alert with that identifier.') },
  AGENT_RUN_NOT_FOUND: { title: { es: 'Ejecución no encontrada', en: 'Agent run not found' }, ...same('No existe una ejecución de agente con ese identificador (puede haber expirado: se conservan 30 días).', 'There is no agent run with that identifier (it may have expired: runs are kept for 30 days).') },
  ALERT_ALREADY_RESOLVED: { title: { es: 'Alerta ya resuelta', en: 'Alert already resolved' }, ...same('La alerta ya está resuelta y no puede reconocerse.', 'The alert is already resolved and cannot be acknowledged.') },
  VALIDATION_FAILED: { title: { es: 'Solicitud no válida', en: 'Invalid request' }, ...same('Revisa los campos enviados.', 'Check the submitted fields.') },
  INVALID_CURSOR: { title: { es: 'Cursor no válido', en: 'Invalid cursor' }, ...same('El cursor de paginación no es válido.', 'The pagination cursor is not valid.') },
  FORBIDDEN: { title: { es: 'Acceso denegado', en: 'Access denied' }, ...same('No tienes permiso para este recurso.', 'You are not allowed to access this resource.') },
  RATE_LIMITED: { title: { es: 'Demasiadas solicitudes', en: 'Too many requests' }, detail: { es: (p) => `Superaste el límite; reintenta en ${p.retryAfterSec ?? '60'} s.`, en: (p) => `Rate limit exceeded; retry in ${p.retryAfterSec ?? '60'} s.` } },
  LLM_UNAVAILABLE: { title: { es: 'Modelo de lenguaje no disponible', en: 'Language model unavailable' }, ...same('No se pudo contactar al modelo de lenguaje; intenta más tarde.', 'The language model could not be reached; try again later.') },
  UPSTREAM_UNAVAILABLE: { title: { es: 'Servicio dependiente no disponible', en: 'Upstream service unavailable' }, ...same('Un servicio del que depende esta consulta no responde.', 'A service this query depends on is not responding.') },
  AGENT_STEP_LIMIT: { title: { es: 'Límite del agente alcanzado', en: 'Agent limit reached' }, ...same('El agente alcanzó su límite de pasos o tokens.', 'The agent reached its step or token limit.') },
  NOT_FOUND: { title: { es: 'Recurso no encontrado', en: 'Resource not found' }, ...same('La ruta o el recurso solicitado no existe.', 'The requested route or resource does not exist.') },
  MALFORMED_REQUEST: { title: { es: 'Solicitud malformada', en: 'Malformed request' }, ...same('No se pudo interpretar la solicitud.', 'The request could not be parsed.') },
  METHOD_NOT_ALLOWED: { title: { es: 'Método no permitido', en: 'Method not allowed' }, ...same('Este método no está disponible en la ruta.', 'This method is not available on the route.') },
  INTERNAL_ERROR: { title: { es: 'Error interno', en: 'Internal error' }, ...same('Ocurrió un error inesperado.', 'An unexpected error occurred.') },
  SERVICE_UNAVAILABLE: { title: { es: 'Servicio no disponible', en: 'Service unavailable' }, ...same('El servicio no está disponible temporalmente.', 'The service is temporarily unavailable.') },
};
