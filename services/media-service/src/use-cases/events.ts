import type { MediaAsset, ModerationResult } from '../entities/media-asset.entity';
import { maxScore } from '../entities/media-asset.entity';
import type { DomainEvent } from './ports/event-publisher';

const iso = (d: Date): string => d.toISOString();

export const MediaEvents = {
  approved(asset: MediaAsset, result: ModerationResult | null, reviewedBy: string | null, now: Date): DomainEvent {
    const a = asset.snapshot;
    return {
      type: 'bandada.media.asset.approved.v1',
      subject: `media/${a.id}`,
      data: { mediaId: a.id, ownerId: a.ownerId, kind: a.kind, decision: 'ALLOW', tags: a.tags, modelVersion: result?.modelVersion ?? 'human', reviewedBy, occurredAt: iso(now) },
    };
  },
  flagged(asset: MediaAsset, result: ModerationResult, now: Date): DomainEvent {
    const a = asset.snapshot;
    return {
      type: 'bandada.media.asset.flagged.v1',
      subject: `media/${a.id}`,
      data: { mediaId: a.id, ownerId: a.ownerId, kind: a.kind, decision: 'REVIEW', labels: result.labels, scores: result.scores, maxScore: maxScore(result.scores), modelVersion: result.modelVersion, occurredAt: iso(now) },
    };
  },
  rejected(asset: MediaAsset, source: 'AUTOMATIC' | 'MODERATOR', scores: Record<string, number>, reviewedBy: string | null, note: string | null, now: Date): DomainEvent {
    const a = asset.snapshot;
    return {
      type: 'bandada.media.asset.rejected.v1',
      subject: `media/${a.id}`,
      data: { mediaId: a.id, ownerId: a.ownerId, kind: a.kind, decision: 'BLOCK', scores, source, reviewedBy, note, occurredAt: iso(now) },
    };
  },
};
