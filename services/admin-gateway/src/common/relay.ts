export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const dec = <T>(s: string): T | null => {
  try {
    return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
};

export const clampFirst = (first: number | null | undefined, max = 50, fallback = 20): number => Math.min(Math.max(first ?? fallback, 1), max);

/** Relay connection from a page of a REST service: `after` is the service's opaque `nextCursor`. */
export function connectionFromPage<T>(items: T[], nextCursor: string | null, after?: string | null) {
  const edges = items.map((node, index) => ({ cursor: enc({ c: after ?? null, i: index }), node }));
  return {
    edges,
    pageInfo: {
      hasNextPage: nextCursor !== null,
      hasPreviousPage: Boolean(after),
      startCursor: edges[0]?.cursor ?? null,
      endCursor: nextCursor,
    } satisfies PageInfo,
  };
}

/** Offset cursors for merged sources (moderation queue). */
export const encodeOffset = (offset: number) => enc({ o: offset });
export const decodeOffset = (cursor: string | null | undefined): number => (cursor ? (dec<{ o: number }>(cursor)?.o ?? 0) : 0);
export const edgeCursor = (offset: number) => encodeOffset(offset);
