import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, NotFound, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { ObjectStorage, PresignedUpload, ThumbnailGenerator } from '../../../use-cases/ports';

export interface S3Options {
  endpoint: string;
  publicEndpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/** S3/MinIO adapter. Data-plane calls use the internal endpoint; presigned URLs are signed with the PUBLIC one (host is part of the signature). */
export class S3ObjectStorage implements ObjectStorage, ThumbnailGenerator {
  readonly internal: S3Client;
  private readonly signer: S3Client;

  constructor(private readonly o: S3Options) {
    const base = { region: o.region, forcePathStyle: o.forcePathStyle, credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey } };
    this.internal = new S3Client({ ...base, endpoint: o.endpoint });
    this.signer = new S3Client({ ...base, endpoint: o.publicEndpoint });
  }

  async presignUpload(key: string, contentType: string, ttlSeconds: number): Promise<PresignedUpload> {
    const url = await getSignedUrl(this.signer, new PutObjectCommand({ Bucket: this.o.bucket, Key: key, ContentType: contentType }), { expiresIn: ttlSeconds });
    return { url, headers: { 'Content-Type': contentType } };
  }

  presignDownload(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(this.signer, new GetObjectCommand({ Bucket: this.o.bucket, Key: key }), { expiresIn: ttlSeconds });
  }

  async head(key: string): Promise<{ size: number; contentType: string | undefined } | null> {
    try {
      const r = await this.internal.send(new HeadObjectCommand({ Bucket: this.o.bucket, Key: key }));
      return { size: r.ContentLength ?? 0, contentType: r.ContentType };
    } catch (error) {
      if (error instanceof NotFound || (error instanceof S3ServiceException && (error.$metadata.httpStatusCode === 404 || error.name === 'NoSuchKey'))) return null;
      throw error;
    }
  }

  async delete(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.internal.send(new DeleteObjectsCommand({ Bucket: this.o.bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }));
  }

  async generate(originalKey: string, mimeType: string, thumbnailKey: string): Promise<string | null> {
    if (mimeType === 'image/heic') return null; // prebuilt sharp has no HEIC decoder: the original is served instead
    const { default: sharp } = await import('sharp');
    const object = await this.internal.send(new GetObjectCommand({ Bucket: this.o.bucket, Key: originalKey }));
    const input = Buffer.from(await (object.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
    const output = await sharp(input).rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    await this.internal.send(new PutObjectCommand({ Bucket: this.o.bucket, Key: thumbnailKey, Body: output, ContentType: 'image/jpeg' }));
    return thumbnailKey;
  }
}
