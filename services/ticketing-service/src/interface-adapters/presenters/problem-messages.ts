import type { Locale } from '@bandada/i18n';

type Template = (params: Record<string, string>) => string;
interface Message {
  title: Record<Locale, string>;
  detail: Record<Locale, Template>;
}

const same = (es: string, en: string): Pick<Message, 'detail'> => ({ detail: { es: () => es, en: () => en } });

export const PROBLEM_STATUS: Record<string, number> = {
  TICKET_NOT_FOUND: 404,
  TICKET_ALREADY_USED: 409,
  TICKET_VOIDED: 409,
  INVALID_QR_SIGNATURE: 422,
  TICKET_EVENT_MISMATCH: 422,
  VALIDATION_WINDOW_CLOSED: 422,
  NOT_EVENT_ORGANIZER: 403,
  FORBIDDEN: 403,
  INVALID_CURSOR: 400,
  VALIDATION_FAILED: 422,
  CONCURRENT_MODIFICATION: 409,
  NOT_FOUND: 404,
  MALFORMED_REQUEST: 400,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export const PROBLEM_MESSAGES: Record<string, Message> = {
  TICKET_NOT_FOUND: {
    title: { es: 'Entrada no encontrada', en: 'Ticket not found' },
    ...same('No existe una entrada con ese identificador.', 'There is no ticket with that identifier.'),
  },
  TICKET_ALREADY_USED: {
    title: { es: 'Entrada ya utilizada', en: 'Ticket already used' },
    detail: {
      es: (p) => (p.usedAt ? `Esta entrada se validó el ${p.usedAt}.` : 'Esta entrada ya fue validada.'),
      en: (p) => (p.usedAt ? `This ticket was validated on ${p.usedAt}.` : 'This ticket was already validated.'),
    },
  },
  TICKET_VOIDED: {
    title: { es: 'Entrada anulada', en: 'Ticket voided' },
    ...same('Esta entrada fue anulada y ya no es válida.', 'This ticket was voided and is no longer valid.'),
  },
  INVALID_QR_SIGNATURE: {
    title: { es: 'Código QR no válido', en: 'Invalid QR code' },
    ...same('La firma del código QR no es válida.', 'The QR code signature is not valid.'),
  },
  TICKET_EVENT_MISMATCH: {
    title: { es: 'La entrada es de otro evento', en: 'Ticket belongs to another event' },
    ...same('La entrada no corresponde al evento que se está controlando.', 'The ticket does not belong to the event being checked.'),
  },
  VALIDATION_WINDOW_CLOSED: {
    title: { es: 'Fuera de la ventana de validación', en: 'Outside the validation window' },
    detail: {
      es: (p) => `Las entradas se validan desde ${p.opensAt} hasta ${p.closesAt}.`,
      en: (p) => `Tickets can be validated from ${p.opensAt} until ${p.closesAt}.`,
    },
  },
  NOT_EVENT_ORGANIZER: {
    title: { es: 'No eres organizador de este evento', en: 'You are not an organizer of this event' },
    ...same('Solo el organizador del evento o su personal puede validar entradas.', 'Only the event organizer or staff can validate tickets.'),
  },
  FORBIDDEN: {
    title: { es: 'Acceso denegado', en: 'Access denied' },
    ...same('No tienes permiso para ver este recurso.', 'You are not allowed to access this resource.'),
  },
  INVALID_CURSOR: {
    title: { es: 'Cursor no válido', en: 'Invalid cursor' },
    ...same('El cursor de paginación no es válido.', 'The pagination cursor is not valid.'),
  },
  VALIDATION_FAILED: {
    title: { es: 'Solicitud no válida', en: 'Invalid request' },
    ...same('Revisa los campos enviados.', 'Check the submitted fields.'),
  },
  CONCURRENT_MODIFICATION: {
    title: { es: 'Modificación concurrente', en: 'Concurrent modification' },
    ...same('La entrada cambió mientras se procesaba; intenta de nuevo.', 'The ticket changed while being processed; try again.'),
  },
  NOT_FOUND: {
    title: { es: 'Recurso no encontrado', en: 'Resource not found' },
    ...same('La ruta o el recurso solicitado no existe.', 'The requested route or resource does not exist.'),
  },
  MALFORMED_REQUEST: {
    title: { es: 'Solicitud malformada', en: 'Malformed request' },
    ...same('No se pudo interpretar la solicitud.', 'The request could not be parsed.'),
  },
  INTERNAL_ERROR: {
    title: { es: 'Error interno', en: 'Internal error' },
    ...same('Ocurrió un error inesperado.', 'An unexpected error occurred.'),
  },
  SERVICE_UNAVAILABLE: {
    title: { es: 'Servicio no disponible', en: 'Service unavailable' },
    ...same('El servicio no está disponible temporalmente.', 'The service is temporarily unavailable.'),
  },
};
