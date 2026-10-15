import type { MediaAsset } from '../entities/media-asset.entity';
import type { MediaOutput } from './outputs';
import { PRESIGN_GET_SECONDS } from './outputs';
import type { ObjectStorage } from './ports';

/** Presigned GET URLs (15 min, RNF-08) for the original and the thumbnail. */
export async function withUrls(storage: ObjectStorage, asset: MediaAsset, includeUrls: boolean): Promise<MediaOutput> {
  const a = asset.snapshot;
  if (!includeUrls) return { asset: a, url: null, thumbnailUrl: null };
  const [url, thumbnailUrl] = await Promise.all([
    storage.presignDownload(a.storageKey, PRESIGN_GET_SECONDS),
    a.thumbnailKey ? storage.presignDownload(a.thumbnailKey, PRESIGN_GET_SECONDS) : Promise.resolve(null),
  ]);
  return { asset: a, url, thumbnailUrl };
}
