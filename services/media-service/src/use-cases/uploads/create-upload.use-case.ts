import { MediaAsset, type MediaKind, type MediaPurpose, type UploadLimits } from '../../entities/media-asset.entity';
import type { UploadTicketOutput } from '../outputs';
import type { Clock, IdGenerator, MediaRepository, ObjectStorage } from '../ports';

export interface CreateUploadInput {
  ownerId: string;
  kind: MediaKind;
  purpose: MediaPurpose;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number | null;
  fileName?: string | null;
}

export class CreateUploadUseCase {
  constructor(
    private readonly media: MediaRepository,
    private readonly storage: ObjectStorage,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly limits: UploadLimits,
    private readonly ttlSeconds: number,
  ) {}

  async execute(input: CreateUploadInput): Promise<UploadTicketOutput> {
    const asset = MediaAsset.requestUpload({ id: this.ids.next(), ...input, ttlSeconds: this.ttlSeconds }, this.limits, this.clock.now());
    const presigned = await this.storage.presignUpload(asset.snapshot.storageKey, input.mimeType, this.ttlSeconds);
    await this.media.insert(asset);
    return { mediaId: asset.id, uploadUrl: presigned.url, uploadHeaders: presigned.headers, expiresIn: this.ttlSeconds };
  }
}
