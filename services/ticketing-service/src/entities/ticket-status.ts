export const TicketStatus = {
  ISSUED: 'ISSUED',
  USED: 'USED',
  VOIDED: 'VOIDED',
} as const;

export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];
