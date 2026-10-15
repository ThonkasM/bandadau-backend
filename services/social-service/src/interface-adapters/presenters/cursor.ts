import { HttpException } from '@nestjs/common';

import type { KeysetCursor } from '../../use-cases/ports';

/** Opaque base64url cursor over the keyset `(createdAt, id)`. */
export function encodeCursor(cursor: KeysetCursor | null): string | null {
  if (!cursor) return null;
  return Buffer.from(JSON.stringify({ t: cursor.createdAt.getTime(), i: cursor.id }), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | undefined): KeysetCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { t?: unknown; i?: unknown };
    if (typeof parsed.t === 'number' && typeof parsed.i === 'string' && Number.isFinite(parsed.t)) return { createdAt: new Date(parsed.t), id: parsed.i };
  } catch {
    /* falls through */
  }
  throw new HttpException({ code: 'VALIDATION_FAILED', errors: [{ field: 'cursor', pointer: '/cursor', code: 'INVALID_VALUE' }] }, 400);
}

/** Offset cursor for the few listings that are not keyset-ordered (internal group ranking). */
export function encodeOffset(offset: number | null): string | null {
  return offset === null ? null : Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

export function decodeOffset(raw: string | undefined): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { o?: unknown };
    if (typeof parsed.o === 'number' && Number.isInteger(parsed.o) && parsed.o >= 0) return parsed.o;
  } catch {
    /* falls through */
  }
  throw new HttpException({ code: 'VALIDATION_FAILED', errors: [{ field: 'cursor', pointer: '/cursor', code: 'INVALID_VALUE' }] }, 400);
}
