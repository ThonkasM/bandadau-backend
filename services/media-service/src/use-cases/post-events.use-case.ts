import type { MediaRepository, ObjectStorage } from './ports';

/** `bandada.social.post.deleted.v1`: removes the stored objects of the post's media (only assets of the post's author). Idempotent. */
export class OnPostDeletedUseCase {
  constructor(
    private readonly media: MediaRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async execute(input: { authorId: string; mediaIds: readonly string[] }): Promise<number> {
    const assets = (await this.media.findByIds(input.mediaIds)).filter((a) => a.ownerId === input.authorId);
    for (const asset of assets) {
      const a = asset.snapshot;
      await this.storage.delete([a.storageKey, ...(a.thumbnailKey ? [a.thumbnailKey] : [])]);
      await this.media.deleteById(a.id);
    }
    return assets.length;
  }
}

/** Purges uploads that never completed within 24 h (UC-05 10a). */
export class PurgeStaleUploadsUseCase {
  constructor(
    private readonly media: MediaRepository,
    private readonly storage: ObjectStorage,
    private readonly now: () => Date,
  ) {}

  async execute(limit = 100): Promise<number> {
    const stale = await this.media.findStale('PENDING_UPLOAD', new Date(this.now().getTime() - 24 * 3_600_000), limit);
    for (const asset of stale) {
      await this.storage.delete([asset.snapshot.storageKey]);
      await this.media.deleteById(asset.id);
    }
    return stale.length;
  }
}
