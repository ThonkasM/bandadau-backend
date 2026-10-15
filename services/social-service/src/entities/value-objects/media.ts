import { DomainError } from '../errors/domain-error';

export type MediaKind = 'IMAGE' | 'VIDEO';
export type MediaStatus = 'PENDING_UPLOAD' | 'PROCESSING' | 'APPROVED' | 'FLAGGED' | 'REJECTED';

export interface MediaAssetView {
  mediaId: string;
  ownerId: string;
  kind: MediaKind;
  status: MediaStatus;
  updatedAt: Date;
}

export const MAX_IMAGES_PER_POST = 4;

/** Up to 4 images or exactly 1 video (RN-05.2). */
export function assertValidMediaCombination(kinds: readonly MediaKind[]): void {
  const videos = kinds.filter((k) => k === 'VIDEO').length;
  const images = kinds.length - videos;
  if (kinds.length > MAX_IMAGES_PER_POST || videos > 1 || (videos === 1 && images > 0)) {
    throw new DomainError('INVALID_MEDIA_COMBINATION');
  }
}

export type MediaVerdict = 'APPROVED' | 'PENDING' | 'BLOCKED';

/** Collapses the statuses of all the assets of a post: any FLAGGED/REJECTED blocks, all APPROVED approves. */
export function mediaVerdict(statuses: readonly (MediaStatus | undefined)[]): MediaVerdict {
  if (statuses.some((s) => s === 'REJECTED' || s === 'FLAGGED')) return 'BLOCKED';
  if (statuses.length > 0 && statuses.every((s) => s === 'APPROVED')) return 'APPROVED';
  return 'PENDING';
}
