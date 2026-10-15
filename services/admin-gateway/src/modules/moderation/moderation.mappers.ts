import type { MediaUrl, ModeratedMedia, ModerationPost, SocialReport } from '../../data-sources/types';

const SEVERITY = { BLOCK: 2, REVIEW: 1, ALLOW: 0 } as const;

export interface MediaAssetModel {
  id: string;
  ownerId: string;
  kind: string;
  purpose: string;
  status: string;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  tags: string[];
  ocrText: string | null;
  moderation: { decision: string; labels: string[]; scores: Record<string, number>; maxScore: number; modelVersion: string } | null;
  createdAt: string;
}

export function mediaModel(m: ModeratedMedia): MediaAssetModel {
  const results = [...(m.moderationResults ?? [])].sort((a, b) => SEVERITY[b.decision] - SEVERITY[a.decision]);
  const top = results[0];
  return {
    id: m.id,
    ownerId: m.ownerId,
    kind: m.kind,
    purpose: m.purpose,
    status: m.status,
    previewUrl: m.url,
    thumbnailUrl: m.thumbnailUrl,
    tags: m.tags ?? [],
    ocrText: m.ocrText ?? null,
    moderation: top
      ? {
          decision: top.decision,
          labels: top.labels ?? [],
          scores: top.scores ?? {},
          maxScore: Math.max(0, ...Object.values(top.scores ?? {})),
          modelVersion: top.modelVersion,
        }
      : null,
    createdAt: m.createdAt,
  };
}

/** Light MediaAsset from the batched URL lookup (post attachments, previews). */
export function mediaFromUrl(u: MediaUrl, ownerId: string, createdAt: string): MediaAssetModel {
  return {
    id: u.mediaId,
    ownerId,
    kind: u.kind,
    purpose: u.purpose ?? 'POST',
    status: u.status,
    previewUrl: u.url,
    thumbnailUrl: u.thumbnailUrl,
    tags: [],
    ocrText: null,
    moderation: null,
    createdAt,
  };
}

export interface PostModel {
  id: string;
  authorId: string;
  text: string | null;
  hashtags: string[];
  visibility: string;
  status: string;
  mediaIds: { mediaId: string; kind: string; status: string; url: string | null; thumbnailUrl: string | null }[];
  createdAt: string;
}

export const postModel = (p: ModerationPost): PostModel => ({
  id: p.id,
  authorId: p.authorId,
  text: p.text ?? null,
  hashtags: p.hashtags ?? [],
  visibility: p.visibility,
  status: p.status,
  mediaIds: p.media ?? [],
  createdAt: p.createdAt,
});

export interface ModerationItemModel {
  id: string;
  source: 'AI' | 'REPORTS';
  media: MediaAssetModel | null;
  post: PostModel | null;
  openReports: number;
  enqueuedAt: string;
}

export const itemFromMedia = (m: ModeratedMedia): ModerationItemModel => ({
  id: m.id,
  source: 'AI',
  media: mediaModel(m),
  post: null,
  openReports: 0,
  enqueuedAt: m.updatedAt ?? m.createdAt,
});

export const itemFromPost = (p: ModerationPost): ModerationItemModel => ({
  id: p.id,
  source: 'REPORTS',
  media: null,
  post: postModel(p),
  openReports: p.reportsCount ?? 0,
  enqueuedAt: p.updatedAt ?? p.createdAt,
});

export const reportModel = (r: SocialReport) => ({ ...r });
