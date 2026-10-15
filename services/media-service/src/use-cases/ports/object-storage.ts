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
  delete(keys: readonly string[]): Promise<void>;
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
}

/** Phase 1: allow-all / manual adapters. Phase 2 swaps in the ONNX classifiers (NSFW, violence, CLIP, OCR) behind this port. */
export interface ModerationPort {
  moderate(input: { assetId: string; storageKey: string; mimeType: string; kind: 'IMAGE' | 'VIDEO' }): Promise<ModerationVerdict>;
}
