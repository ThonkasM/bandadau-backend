import { DomainError } from '../../entities/errors/domain-error';
import type { HumanDecision } from '../../entities/media-asset.entity';
import { MediaEvents } from '../events';
import { withUrls } from '../media-urls';
import type { MediaOutput } from '../outputs';
import type { Clock, EventPublisher, MediaRepository, ObjectStorage, UnitOfWork } from '../ports';

export class DecideMediaUseCase {
  constructor(
    private readonly media: MediaRepository,
    private readonly storage: ObjectStorage,
    private readonly events: EventPublisher,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: { mediaId: string; decision: HumanDecision; note?: string | null; actorId: string }): Promise<MediaOutput> {
    const asset = await this.media.findById(input.mediaId);
    if (!asset) throw new DomainError('NOT_FOUND');
    const now = this.clock.now();
    if (asset.decide(input.decision, input.note ?? null, input.actorId, now)) {
      await this.uow.run(async () => {
        if (!(await this.media.save(asset, ['FLAGGED']))) throw new DomainError('MEDIA_NOT_FLAGGED');
        if (input.decision === 'APPROVE') await this.events.publish(MediaEvents.approved(asset, null, input.actorId, now));
        else await this.events.publish(MediaEvents.rejected(asset, 'MODERATOR', asset.snapshot.moderationResults.at(-1)?.scores ?? {}, input.actorId, input.note ?? null, now));
      });
    }
    return withUrls(this.storage, asset, true);
  }
}
