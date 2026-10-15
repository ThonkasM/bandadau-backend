import type { Ticket } from './ticket.entity';

export interface ValidationWindowConfig {
  opensBeforeStartMs: number;
  /** Used when the event end is unknown. */
  defaultDurationMs: number;
}

export interface ValidationWindow {
  opensAt: Date;
  closesAt: Date;
}

/** RN-14.3: from `startsAt - 2h` until the end of the event. */
export function validationWindowOf(ticket: Ticket, config: ValidationWindowConfig): ValidationWindow {
  const start = ticket.eventStartsAt.getTime();
  const end = ticket.eventEndsAt?.getTime() ?? start + config.defaultDurationMs;
  return { opensAt: new Date(start - config.opensBeforeStartMs), closesAt: new Date(end) };
}

export function isWindowOpen(window: ValidationWindow, now: Date): boolean {
  return now.getTime() >= window.opensAt.getTime() && now.getTime() <= window.closesAt.getTime();
}
