import type { components } from '@bandada/contracts-ts/openapi/media';

import type { MediaOutput, UploadTicketOutput } from '../../use-cases/outputs';
import type { Page } from '../../use-cases/ports';
import type { MediaUrlOutput } from '../../use-cases/queries/media-queries.use-cases';
import { encodeCursor } from './cursor';

type S = components['schemas'];
const iso = (d: Date): string => d.toISOString();

export const presentTicket = (t: UploadTicketOutput): S['UploadTicket'] => ({ mediaId: t.mediaId, uploadUrl: t.uploadUrl, uploadMethod: 'PUT', uploadHeaders: t.uploadHeaders, expiresIn: t.expiresIn });

export function presentMedia(o: MediaOutput): S['MediaAsset'] {
  const a = o.asset;
  return {
    id: a.id,
    ownerId: a.ownerId,
    kind: a.kind,
    purpose: a.purpose,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    durationSeconds: a.durationSeconds,
    status: a.status,
    url: o.url,
    thumbnailUrl: o.thumbnailUrl,
    tags: [...a.tags],
    ocrText: a.ocrText,
    createdAt: iso(a.createdAt),
    updatedAt: iso(a.updatedAt),
  };
}

export function presentModerated(o: MediaOutput): S['ModeratedMedia'] {
  const a = o.asset;
  return {
    ...presentMedia(o),
    moderationResults: a.moderationResults.map((r) => ({ model: r.model, modelVersion: r.modelVersion, labels: [...r.labels], scores: { ...r.scores }, decision: r.decision, frameIndex: r.frameIndex, createdAt: iso(r.createdAt) })),
    finalDecision: a.finalDecision ? { decision: a.finalDecision.decision, note: a.finalDecision.note, decidedBy: a.finalDecision.decidedBy, decidedAt: iso(a.finalDecision.decidedAt) } : null,
  };
}

export const presentModeratedPage = (p: Page<MediaOutput>): S['ModeratedMediaPage'] => ({ items: p.items.map(presentModerated), nextCursor: encodeCursor(p.nextCursor) });

export const presentUrl = (u: MediaUrlOutput): S['MediaUrl'] => ({
  mediaId: u.mediaId,
  kind: u.kind as S['MediaKind'],
  purpose: u.purpose as S['MediaPurpose'],
  status: u.status,
  url: u.url,
  thumbnailUrl: u.thumbnailUrl,
  expiresAt: u.expiresAt ? iso(u.expiresAt) : null,
});
