import type { MediaKind, MediaStatus } from '../../entities/value-objects/media';

export const MEDIA_GATEWAY = Symbol('MediaGateway');

export interface MediaAssetInfo {
  mediaId: string;
  ownerId: string;
  kind: MediaKind;
  purpose: string;
  status: MediaStatus;
}

export interface MediaUrlInfo {
  mediaId: string;
  kind: MediaKind;
  status: MediaStatus;
  url: string | null;
  thumbnailUrl: string | null;
}

export interface MediaGateway {
  /** media-service `getMediaInternal`; ids that do not exist are omitted. Throws DomainError SERVICE_UNAVAILABLE when unreachable. */
  getAssets(ids: readonly string[]): Promise<MediaAssetInfo[]>;
  /** media-service `getMediaUrls` in batch. Degrades to an empty list when media-service is slow or down (feed never fails). */
  getUrls(ids: readonly string[]): Promise<MediaUrlInfo[]>;
}
