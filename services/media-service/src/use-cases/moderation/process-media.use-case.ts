import type { ModerationResult } from '../../entities/media-asset.entity';
import { MediaEvents } from '../events';
import type { Clock, EventPublisher, MediaRepository, ModerationPort, ObjectStorage, ThumbnailGenerator, UnitOfWork } from '../ports';

/** Runs the moderation port on a PROCESSING asset and publishes the resulting event (approved / flagged / rejected) with the outbox. */
export class ProcessMediaUseCase {
  constructor(
    private readonly media: MediaRepository,
    private readonly moderation: ModerationPort,
    private readonly thumbnails: ThumbnailGenerator,
    private readonly events: EventPublisher,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly storage: ObjectStorage,
  ) {}

  async execute(assetId: string): Promise<void> {
    const asset = await this.media.findById(assetId);
    if (!asset || asset.status !== 'PROCESSING') return;
    const a = asset.snapshot;
    let thumbKey = a.kind === 'IMAGE' ? await this.thumbnails.generate(a.storageKey, a.mimeType, `media/${a.ownerId}/${a.id}/thumbnail.jpg`).catch(() => null) : null;
    if (thumbKey) asset.setThumbnail(thumbKey);
    const verdict = await this.moderation.moderate({ assetId: a.id, storageKey: a.storageKey, mimeType: a.mimeType, kind: a.kind });
    if (verdict.thumbnailJpeg) {
      const key = `media/${a.ownerId}/${a.id}/thumbnail.jpg`;
      await this.storage.put(key, verdict.thumbnailJpeg, 'image/jpeg');
      thumbKey = key;
      asset.setThumbnail(key);
    }
    const now = this.clock.now();
    const result: ModerationResult = { model: verdict.model, modelVersion: verdict.modelVersion, labels: verdict.labels, scores: verdict.scores, decision: verdict.decision, frameIndex: verdict.frameIndex ?? null, ...(verdict.frameScores ? { frameScores: verdict.frameScores } : {}), createdAt: now };
    asset.applyModeration(result, now);
    await this.uow.run(async () => {
      if (!(await this.media.save(asset, ['PROCESSING']))) return;
      if (verdict.decision === 'ALLOW') await this.events.publish(MediaEvents.approved(asset, result, null, now));
      else if (verdict.decision === 'REVIEW') await this.events.publish(MediaEvents.flagged(asset, result, now));
      else await this.events.publish(MediaEvents.rejected(asset, 'AUTOMATIC', result.scores, null, null, now));
    });
  }
}

/** Re-queues assets stuck in PROCESSING (crash between 202 and the worker). */
export class RequeueStaleProcessingUseCase {
  constructor(
    private readonly media: MediaRepository,
    private readonly clock: Clock,
  ) {}

  async execute(olderThanMs: number, limit = 50): Promise<string[]> {
    const stale = await this.media.findStale('PROCESSING', new Date(this.clock.now().getTime() - olderThanMs), limit);
    return stale.map((a) => a.id);
  }
}
