export const OBJECT_STORAGE = Symbol('ObjectStorage');
export const MODERATION_PORT = Symbol('ModerationPort');
export const THUMBNAIL_GENERATOR = Symbol('ThumbnailGenerator');

export interface PresignedUpload {
  url: string;
  headers: Record<string, string>;
}

export interface ObjectStorage {
  /** Presigned PUT built with the PUBLIC endpoint (browsers/phones reach it, not the Docker hostname). */
  presignUpload(key: string, contentType: string, ttlSeconds: number): Promise<PresignedUpload>;
  presignDownload(key: string, ttlSeconds: number): Promise<string>;
  /** HeadObject; null when the object does not exist. */
  head(key: string): Promise<{ size: number; contentType: string | undefined } | null>;
  /** First `length` bytes of the object (ranged GET); used to verify magic bytes. */
  readHead(key: string, length: number): Promise<Uint8Array>;
  delete(keys: readonly string[]): Promise<void>;
  /** Downloads the whole object (<= MAX_VIDEO_BYTES). */
  get(key: string): Promise<Buffer>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
}

export interface ThumbnailGenerator {
  /** Generates a JPEG thumbnail next to the original and returns its key, or null when not applicable. */
  generate(originalKey: string, mimeType: string, thumbnailKey: string): Promise<string | null>;
}

export interface ModerationVerdict {
  model: string;
  modelVersion: string;
  decision: 'ALLOW' | 'REVIEW' | 'BLOCK';
  labels: string[];
  scores: Record<string, number>;
  /** Video: P(nsfw) per frame and index of the worst frame. */
  frameScores?: { index: number; timestampSeconds: number; nsfw: number }[];
  frameIndex?: number | null;
  /** Video: best frame as JPEG, to be stored as the thumbnail. */
  thumbnailJpeg?: Buffer;
}

export interface ModerationStatus {
  mode: string;
  /** READY: classifiers loaded; DEGRADED: model failed to load, everything goes to manual review; N/A: no classifier needed. */
  state: 'READY' | 'DEGRADED' | 'N/A';
  model?: string;
  detail?: string;
}

/** allow-all / manual (phase 1) and onnx (phase 2: NSFW classifier + ffmpeg for video) adapters. */
export interface ModerationPort {
  moderate(input: { assetId: string; storageKey: string; mimeType: string; kind: 'IMAGE' | 'VIDEO' }): Promise<ModerationVerdict>;
  status?(): ModerationStatus;
}
