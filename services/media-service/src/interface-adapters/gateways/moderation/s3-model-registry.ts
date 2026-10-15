import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { type ModelMetadata, parseMetadata } from './model-metadata';

export interface ModelRegistryOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  cacheDir: string;
}

export interface LoadedModelFiles {
  metadata: ModelMetadata;
  modelPath: string;
  sha256: string;
}

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** Downloads `models/<name>/<version>/{metadata.json,model*.onnx}` from S3/MinIO into a local cache, verifying sha256. Falls back to a complete cache when S3 is down. */
export class S3ModelRegistry {
  private readonly s3: S3Client;
  constructor(private readonly o: ModelRegistryOptions) {
    this.s3 = new S3Client({ endpoint: o.endpoint, region: o.region, forcePathStyle: o.forcePathStyle, credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey } });
  }

  private async fetch(key: string): Promise<Buffer> {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.o.bucket, Key: key }));
    return Buffer.from(await (r.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
  }

  async load(name: string, version: string, variant: 'fp32' | 'int8'): Promise<LoadedModelFiles> {
    const dir = join(this.o.cacheDir, name, version);
    await mkdir(dir, { recursive: true });
    const metaPath = join(dir, 'metadata.json');
    let metaRaw: Buffer;
    try {
      metaRaw = await this.fetch(`models/${name}/${version}/metadata.json`);
      await writeFile(metaPath, metaRaw);
    } catch (error) {
      metaRaw = await readFile(metaPath).catch(() => {
        throw new Error(`model metadata unavailable (S3: ${String(error)}; no cache)`);
      });
    }
    const metadata = parseMetadata(metaRaw.toString('utf8'));
    const art = metadata.artifacts?.[variant] ?? (variant === 'fp32' ? { file: 'model.onnx', sha256: metadata.sha256 } : undefined);
    if (!art) throw new Error(`variant ${variant} not published for ${name}@${version}`);
    const modelPath = join(dir, art.file);
    const cached = await readFile(modelPath).catch(() => null);
    if (cached && sha256(cached) === art.sha256) return { metadata, modelPath, sha256: art.sha256 };
    const body = await this.fetch(`models/${name}/${version}/${art.file}`);
    if (sha256(body) !== art.sha256) throw new Error(`sha256 mismatch for ${name}@${version}/${art.file}`);
    await writeFile(`${modelPath}.tmp`, body);
    await rename(`${modelPath}.tmp`, modelPath);
    return { metadata, modelPath, sha256: art.sha256 };
  }
}
