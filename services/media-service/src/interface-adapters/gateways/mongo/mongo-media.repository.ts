import type { Document } from 'mongodb';

import { MediaAsset, type MediaStatus } from '../../../entities/media-asset.entity';
import type { FlaggedQuery, MediaRepository } from '../../../use-cases/ports';
import { keyset, type MongoContext } from './mongo-context';

const toAsset = (d: Document): MediaAsset =>
  MediaAsset.restore({
    id: d._id,
    ownerId: d.ownerId,
    kind: d.kind,
    purpose: d.purpose,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    durationSeconds: d.durationSeconds ?? null,
    fileName: d.fileName ?? null,
    status: d.status,
    storageKey: d.storageKey,
    thumbnailKey: d.thumbnailKey ?? null,
    tags: d.tags ?? [],
    ocrText: d.ocrText ?? null,
    moderationResults: d.moderationResults ?? [],
    finalDecision: d.finalDecision ?? null,
    uploadExpiresAt: d.uploadExpiresAt,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  });

export class MongoMediaRepository implements MediaRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get col() {
    return this.ctx.col('mediaAssets');
  }

  async insert(asset: MediaAsset): Promise<void> {
    const { id, ...rest } = asset.snapshot;
    await this.col.insertOne({ _id: id as never, ...rest }, this.ctx.opts);
  }

  async findById(id: string): Promise<MediaAsset | null> {
    const d = await this.col.findOne({ _id: id as never }, this.ctx.opts);
    return d ? toAsset(d) : null;
  }

  async findByIds(ids: readonly string[]): Promise<MediaAsset[]> {
    if (ids.length === 0) return [];
    return (await this.col.find({ _id: { $in: [...ids] } as never }, this.ctx.opts).toArray()).map(toAsset);
  }

  async save(asset: MediaAsset, expected: readonly MediaStatus[]): Promise<boolean> {
    const { id, ...rest } = asset.snapshot;
    const res = await this.col.updateOne({ _id: id as never, status: { $in: [...expected] } }, { $set: rest }, this.ctx.opts);
    return res.modifiedCount === 1;
  }

  async list(q: FlaggedQuery): Promise<MediaAsset[]> {
    const filter: Document = { status: q.status, ...(q.ownerId ? { ownerId: q.ownerId } : {}), ...(q.since ? { updatedAt: { $gte: q.since } } : {}), ...keyset(q.cursor, 'createdAt', true) };
    return (await this.col.find(filter, this.ctx.opts).sort({ createdAt: 1, _id: 1 }).limit(q.limit).toArray()).map(toAsset);
  }

  async findStale(status: MediaStatus, olderThan: Date, limit: number): Promise<MediaAsset[]> {
    const field = status === 'PROCESSING' ? 'updatedAt' : 'createdAt';
    return (await this.col.find({ status, [field]: { $lt: olderThan } }, this.ctx.opts).limit(limit).toArray()).map(toAsset);
  }

  async deleteById(id: string): Promise<void> {
    await this.col.deleteOne({ _id: id as never }, this.ctx.opts);
  }
}
