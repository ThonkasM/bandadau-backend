import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { AudioStorage } from '../../../use-cases/ports/misc';

export interface S3Options {
  bucket: string;
  region: string;
  endpoint?: string;
  publicEndpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/** Reports bucket (MinIO locally, S3 in AWS). Uploads use the internal endpoint; presigned URLs are signed against the public one. */
export class S3AudioStorage implements AudioStorage {
  private readonly internal: S3Client;
  private readonly signer: S3Client;

  constructor(private readonly o: S3Options) {
    const credentials = o.accessKeyId && o.secretAccessKey ? { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey } : undefined;
    const base = { region: o.region, forcePathStyle: Boolean(o.endpoint), ...(credentials ? { credentials } : {}) };
    this.internal = new S3Client({ ...base, ...(o.endpoint ? { endpoint: o.endpoint } : {}) });
    this.signer = new S3Client({ ...base, ...(o.publicEndpoint ?? o.endpoint ? { endpoint: o.publicEndpoint ?? o.endpoint } : {}) });
  }

  async put(key: string, body: Buffer, mime: string): Promise<void> {
    await this.internal.send(new PutObjectCommand({ Bucket: this.o.bucket, Key: key, Body: body, ContentType: mime }));
  }

  presignedUrl(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(this.signer, new GetObjectCommand({ Bucket: this.o.bucket, Key: key }), { expiresIn: ttlSeconds });
  }
}
