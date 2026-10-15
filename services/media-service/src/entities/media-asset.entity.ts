import { DomainError } from './errors/domain-error';

export type MediaKind = 'IMAGE' | 'VIDEO';
export type MediaPurpose = 'POST' | 'AVATAR' | 'EVENT_COVER';
export type MediaStatus = 'PENDING_UPLOAD' | 'PROCESSING' | 'APPROVED' | 'FLAGGED' | 'REJECTED';
export type ModerationDecision = 'ALLOW' | 'REVIEW' | 'BLOCK';
export type HumanDecision = 'APPROVE' | 'REJECT';

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime'] as const;
export const MAX_VIDEO_SECONDS = 60;

export interface ModerationResult {
  model: string;
  modelVersion: string;
  labels: string[];
  scores: Record<string, number>;
  decision: ModerationDecision;
  frameIndex: number | null;
  /** Video only: P(nsfw) per analysed frame (score of the video = max). */
  frameScores?: number[];
  createdAt: Date;
}

export interface FinalDecision {
  decision: HumanDecision;
  note: string | null;
  decidedBy: string;
  decidedAt: Date;
}

export interface MediaAssetProps {
  id: string;
  ownerId: string;
  kind: MediaKind;
  purpose: MediaPurpose;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  fileName: string | null;
  status: MediaStatus;
  storageKey: string;
  thumbnailKey: string | null;
  tags: string[];
  ocrText: string | null;
  moderationResults: ModerationResult[];
  finalDecision: FinalDecision | null;
  uploadExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UploadLimits {
  maxImageBytes: number;
  maxVideoBytes: number;
}

export interface NewUpload {
  id: string;
  ownerId: string;
  kind: MediaKind;
  purpose: MediaPurpose;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number | null;
  fileName?: string | null;
  ttlSeconds: number;
}

export class MediaAsset {
  private constructor(private readonly props: MediaAssetProps) {}

  static restore(props: MediaAssetProps): MediaAsset {
    return new MediaAsset({ ...props, tags: [...props.tags], moderationResults: [...props.moderationResults] });
  }

  /** Validates type, size, duration and purpose (UC-05 RN-05.2, RF-06) and starts the asset as PENDING_UPLOAD. */
  static requestUpload(input: NewUpload, limits: UploadLimits, now: Date): MediaAsset {
    const mimeOk = input.kind === 'IMAGE' ? (IMAGE_MIME_TYPES as readonly string[]).includes(input.mimeType) : (VIDEO_MIME_TYPES as readonly string[]).includes(input.mimeType);
    if (!mimeOk) throw new DomainError('UNSUPPORTED_MEDIA_TYPE');
    if (input.purpose !== 'POST' && input.kind !== 'IMAGE') throw new DomainError('UNSUPPORTED_MEDIA_TYPE');
    if (input.sizeBytes <= 0) throw new DomainError('VALIDATION_FAILED', { field: 'sizeBytes', code: 'INVALID_VALUE' });
    if (input.sizeBytes > (input.kind === 'IMAGE' ? limits.maxImageBytes : limits.maxVideoBytes)) throw new DomainError('MEDIA_TOO_LARGE');
    if (input.kind === 'VIDEO') {
      if (input.durationSeconds === undefined || input.durationSeconds === null) throw new DomainError('VALIDATION_FAILED', { field: 'durationSeconds', code: 'REQUIRED' });
      if (input.durationSeconds > MAX_VIDEO_SECONDS) throw new DomainError('VIDEO_TOO_LONG');
    }
    return new MediaAsset({
      id: input.id,
      ownerId: input.ownerId,
      kind: input.kind,
      purpose: input.purpose,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      durationSeconds: input.kind === 'VIDEO' ? (input.durationSeconds ?? null) : null,
      fileName: input.fileName ?? null,
      status: 'PENDING_UPLOAD',
      storageKey: `media/${input.ownerId}/${input.id}/original`,
      thumbnailKey: null,
      tags: [],
      ocrText: null,
      moderationResults: [],
      finalDecision: null,
      uploadExpiresAt: new Date(now.getTime() + input.ttlSeconds * 1000),
      createdAt: now,
      updatedAt: now,
    });
  }

  get id(): string { return this.props.id; }
  get ownerId(): string { return this.props.ownerId; }
  get kind(): MediaKind { return this.props.kind; }
  get status(): MediaStatus { return this.props.status; }
  get snapshot(): Readonly<MediaAssetProps> { return this.props; }

  /** Objects the client uploaded must match what it declared (HeadObject). */
  verifyUpload(object: { size: number; contentType: string | undefined } | null, now: Date): void {
    if (!object) throw new DomainError(now > this.props.uploadExpiresAt ? 'UPLOAD_EXPIRED' : 'UPLOAD_MISSING');
    const type = (object.contentType ?? '').split(';')[0]?.trim().toLowerCase();
    if (object.size !== this.props.sizeBytes || type !== this.props.mimeType) throw new DomainError('UPLOAD_MISMATCH');
  }

  startProcessing(now: Date): void {
    this.props.status = 'PROCESSING';
    this.props.updatedAt = now;
  }

  setThumbnail(key: string): void {
    this.props.thumbnailKey = key;
  }

  /** Applies the automatic verdict: ALLOW -> APPROVED, REVIEW -> FLAGGED, BLOCK -> REJECTED. */
  applyModeration(result: ModerationResult, now: Date): void {
    this.props.moderationResults.push(result);
    this.props.tags = [...new Set([...this.props.tags, ...result.labels.filter((l) => !l.startsWith('moderation:'))])];
    this.props.status = result.decision === 'ALLOW' ? 'APPROVED' : result.decision === 'REVIEW' ? 'FLAGGED' : 'REJECTED';
    this.props.updatedAt = now;
  }

  /** Human decision on a FLAGGED asset. Returns false when the same decision was already applied (idempotent). */
  decide(decision: HumanDecision, note: string | null, actorId: string, now: Date): boolean {
    const target: MediaStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    if (this.props.status === target && this.props.finalDecision?.decision === decision) return false;
    if (this.props.status !== 'FLAGGED') throw new DomainError('MEDIA_NOT_FLAGGED');
    this.props.status = target;
    this.props.finalDecision = { decision, note, decidedBy: actorId, decidedAt: now };
    this.props.updatedAt = now;
    return true;
  }
}

export const maxScore = (scores: Record<string, number>): number => Object.values(scores).reduce((a, b) => Math.max(a, b), 0);
