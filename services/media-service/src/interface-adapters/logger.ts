import type { LoggerService } from '@nestjs/common';

import { requestContext } from './request-context';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** One JSON object per line; adds `correlationId`/`traceId` from the request context. Never logs bodies or tokens. */
export class JsonLogger implements LoggerService {
  constructor(
    private readonly service: string,
    private readonly minLevel: Level = 'info',
    private readonly sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  ) {}

  private write(level: Level, message: unknown, context?: Record<string, unknown>): void {
    if (ORDER[level] < ORDER[this.minLevel]) return;
    const rc = requestContext.get();
    this.sink(
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        service: this.service,
        msg: typeof message === 'string' ? message : JSON.stringify(message),
        ...(rc ? { correlationId: rc.correlationId, traceId: rc.traceId } : {}),
        ...context,
      }),
    );
  }

  debug(message: unknown, context?: Record<string, unknown>): void {
    this.write('debug', message, typeof context === 'object' ? context : undefined);
  }
  info(message: unknown, context?: Record<string, unknown>): void {
    this.write('info', message, typeof context === 'object' ? context : undefined);
  }
  warn(message: unknown, context?: Record<string, unknown>): void {
    this.write('warn', message, typeof context === 'object' ? context : undefined);
  }
  error(message: unknown, context?: Record<string, unknown>): void {
    this.write('error', message, typeof context === 'object' ? context : undefined);
  }

  // Nest LoggerService surface (framework messages): `log(message, contextName)`.
  log(message: unknown, ...rest: unknown[]): void {
    this.write('info', message, typeof rest[0] === 'string' ? { context: rest[0] } : undefined);
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    this.write('debug', message, typeof rest[0] === 'string' ? { context: rest[0] } : undefined);
  }
  fatal(message: unknown, ...rest: unknown[]): void {
    this.write('error', message, typeof rest[0] === 'string' ? { context: rest[0] } : undefined);
  }
}
