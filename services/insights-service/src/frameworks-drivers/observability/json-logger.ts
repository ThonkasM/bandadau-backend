import type { LoggerService } from '@nestjs/common';

import type { AppLogger } from '../../use-cases/ports/misc';

type Level = 'debug' | 'info' | 'warn' | 'error';

/** One JSON object per line on stdout (picked up by Loki): `{ ts, level, service, msg, ...context }`. */
export class JsonLogger implements LoggerService, AppLogger {
  constructor(
    private readonly service = 'insights-service',
    private readonly sink: (line: string) => void = (l) => process.stdout.write(`${l}\n`),
  ) {}

  private emit(level: Level, msg: unknown, context?: Record<string, unknown> | string): void {
    const base: Record<string, unknown> = { ts: new Date().toISOString(), level, service: this.service, msg: typeof msg === 'string' ? msg : JSON.stringify(msg) };
    if (typeof context === 'string') base.context = context;
    else if (context) Object.assign(base, context);
    this.sink(JSON.stringify(base));
  }

  info(msg: string, ctx?: Record<string, unknown>): void {
    this.emit('info', msg, ctx);
  }
  warn(msg: string, ctx?: Record<string, unknown>): void {
    this.emit('warn', msg, ctx);
  }
  error(msg: string, ctx?: Record<string, unknown>): void {
    this.emit('error', msg, ctx);
  }
  // Nest LoggerService
  log(message: unknown, ...optional: unknown[]): void {
    this.emit('info', message, typeof optional[0] === 'string' ? optional[0] : undefined);
  }
  debug(message: unknown, ...optional: unknown[]): void {
    if (process.env.LOG_LEVEL === 'debug') this.emit('debug', message, typeof optional[0] === 'string' ? optional[0] : undefined);
  }
  verbose(): void {
    /* silenced */
  }
  fatal(message: unknown, ...optional: unknown[]): void {
    this.emit('error', message, typeof optional[0] === 'string' ? optional[0] : undefined);
  }
}
