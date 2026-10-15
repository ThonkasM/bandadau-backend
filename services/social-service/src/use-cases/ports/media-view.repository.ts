import type { MediaAssetView } from '../../entities/value-objects/media';

export const MEDIA_VIEW_REPOSITORY = Symbol('MediaAssetViewRepository');

export interface MediaAssetViewRepository {
  findMany(ids: readonly string[]): Promise<Map<string, MediaAssetView>>;
  /** Event-sourced truth: overwrites. */
  upsert(view: MediaAssetView): Promise<void>;
  /** Snapshot taken from media-service: never overwrites a final status (APPROVED/FLAGGED/REJECTED) received by event. */
  upsertIfNotFinal(view: MediaAssetView): Promise<void>;
}
