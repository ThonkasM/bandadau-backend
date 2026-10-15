/** Stable keyset cursor: ordered by (createdAt DESC, id DESC) unless the repository says otherwise. */
export interface KeysetCursor {
  createdAt: Date;
  id: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: KeysetCursor | null;
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
