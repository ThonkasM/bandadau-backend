import type { KeysetCursor, Page } from './ports/pagination';

/** `rows` were fetched with `limit + 1`; the extra row only tells that another page exists. */
export function paginate<T>(rows: readonly T[], limit: number, key: (row: T) => KeysetCursor): Page<T> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? key(last) : null };
}
