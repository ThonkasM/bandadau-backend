import { DomainError } from '../../entities/errors/domain-error';
import type { MediaStatus } from '../../entities/media-asset.entity';
import { withUrls } from '../media-urls';
import type { MediaOutput } from '../outputs';
import { PRESIGN_GET_SECONDS } from '../outputs';
import { paginate } from '../paginate';
import type { Clock, KeysetCursor, MediaRepository, ObjectStorage, Page } from '../ports';

/** `getMedia`: the owner sees it in any state; everybody else only when APPROVED (404 otherwise). */
export class GetMediaUseCase {
  constructor(
    private readonly media: MediaRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async execute(input: { mediaId: string; userId: string }): Promise<MediaOutput> {
    const asset = await this.media.findById(input.mediaId);
    if (!asset || (asset.ownerId !== input.userId && asset.status !== 'APPROVED')) throw new DomainError('NOT_FOUND');
    return withUrls(this.storage, asset, asset.status === 'APPROVED' || asset.ownerId === input.userId);
  }
}

export class GetMediaInternalUseCase {
  constructor(
    private readonly media: MediaRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async execute(mediaId: string): Promise<MediaOutput> {
    const asset = await this.media.findById(mediaId);
    if (!asset) throw new DomainError('NOT_FOUND');
    return withUrls(this.storage, asset, true);
  }
}

export interface MediaUrlOutput {
  mediaId: string;
  kind: string;
  purpose: string;
  status: MediaStatus;
  url: string | null;
  thumbnailUrl: string | null;
  expiresAt: Date | null;
}

export class GetMediaUrlsUseCase {
  constructor(
    private readonly media: MediaRepository,
    private readonly storage: ObjectStorage,
    private readonly clock: Clock,
  ) {}

  /** Batch lookup; unknown ids are omitted; URLs are null unless APPROVED (or `includeUnapproved` from admin-gateway). */
  async execute(input: { ids: readonly string[]; includeUnapproved: boolean }): Promise<MediaUrlOutput[]> {
    const assets = await this.media.findByIds([...new Set(input.ids)]);
    const expiresAt = new Date(this.clock.now().getTime() + PRESIGN_GET_SECONDS * 1000);
    return Promise.all(
      assets.map(async (asset): Promise<MediaUrlOutput> => {
        const a = asset.snapshot;
        const visible = a.status === 'APPROVED' || input.includeUnapproved;
        const out = await withUrls(this.storage, asset, visible);
        return { mediaId: a.id, kind: a.kind, purpose: a.purpose, status: a.status, url: out.url, thumbnailUrl: out.thumbnailUrl, expiresAt: visible ? expiresAt : null };
      }),
    );
  }
}

export class ListFlaggedMediaUseCase {
  constructor(
    private readonly media: MediaRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async execute(input: { status: MediaStatus; ownerId?: string; since?: Date; cursor: KeysetCursor | null; limit: number }): Promise<Page<MediaOutput>> {
    const rows = await this.media.list({ ...input, limit: input.limit + 1 });
    const page = paginate(rows, input.limit, (a) => ({ createdAt: a.snapshot.createdAt, id: a.id }));
    return { items: await Promise.all(page.items.map((a) => withUrls(this.storage, a, true))), nextCursor: page.nextCursor };
  }
}
