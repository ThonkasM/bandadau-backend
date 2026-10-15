import type { MediaAsset, MediaStatus } from '../../entities/media-asset.entity';
import type { KeysetCursor } from './pagination';

export const MEDIA_REPOSITORY = Symbol('MediaRepository');

export interface FlaggedQuery {
  status: MediaStatus;
  ownerId?: string;
  since?: Date;
  cursor: KeysetCursor | null;
  limit: number;
}

export interface MediaRepository {
  insert(asset: MediaAsset): Promise<void>;
  findById(id: string): Promise<MediaAsset | null>;
  findByIds(ids: readonly string[]): Promise<MediaAsset[]>;
  /** Compare-and-set on the stored status. Returns whether the document changed. */
  save(asset: MediaAsset, expected: readonly MediaStatus[]): Promise<boolean>;
  /** Oldest first, by createdAt. */
  list(query: FlaggedQuery): Promise<MediaAsset[]>;
  findStale(status: MediaStatus, olderThan: Date, limit: number): Promise<MediaAsset[]>;
  deleteById(id: string): Promise<void>;
}
