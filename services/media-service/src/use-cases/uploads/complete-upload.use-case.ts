import { DomainError } from '../../entities/errors/domain-error';
import { withUrls } from '../media-urls';
import type { MediaOutput } from '../outputs';
import type { Clock, MediaRepository, ObjectStorage } from '../ports';

/** Port of the in-process processing queue (the worker calls ProcessMediaUseCase). */
export const PROCESSING_QUEUE = Symbol('ProcessingQueue');
export interface ProcessingQueue {
  enqueue(assetId: string): void;
}

export class CompleteUploadUseCase {
  constructor(
    private readonly media: MediaRepository,
    private readonly storage: ObjectStorage,
    private readonly queue: ProcessingQueue,
    private readonly clock: Clock,
  ) {}

  /** 202 semantics: idempotent by state. PENDING_UPLOAD -> PROCESSING once; any other state answers the current one. */
  async execute(input: { mediaId: string; userId: string }): Promise<MediaOutput> {
    const asset = await this.media.findById(input.mediaId);
    if (!asset) throw new DomainError('NOT_FOUND');
    if (asset.ownerId !== input.userId) throw new DomainError('FORBIDDEN');
    if (asset.status === 'PENDING_UPLOAD') {
      const now = this.clock.now();
      asset.verifyUpload(await this.storage.head(asset.snapshot.storageKey), now);
      asset.startProcessing(now);
      if (await this.media.save(asset, ['PENDING_UPLOAD'])) this.queue.enqueue(asset.id);
    }
    const current = (await this.media.findById(input.mediaId)) ?? asset;
    return withUrls(this.storage, current, current.status === 'APPROVED');
  }
}
