import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { uuidv7 } from '@bandada/messaging-ts';
import sharp from 'sharp';

import { OnnxImageClassifier } from '../../src/interface-adapters/gateways/moderation/onnx-image-classifier';
import { S3ModelRegistry } from '../../src/interface-adapters/gateways/moderation/s3-model-registry';
import { type Harness, startHarness } from '../support/harness';

const S3 = process.env.TEST_S3_ENDPOINT ?? 'http://localhost:9000';
const owner = uuidv7();
const FIX = join(__dirname, '..', 'fixtures', 'nsfw-classifier');
const waitFor = async <T>(fn: () => Promise<T | undefined | false>, ms = 30000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 150));
  }
};
const cacheDir = mkdtempSync(join(tmpdir(), 'model-cache-'));
const harnesses: Harness[] = [];
afterAll(async () => {
  for (const h of harnesses) await h.stop();
  rmSync(cacheDir, { recursive: true, force: true });
});

const common = { MODEL_CACHE_DIR: cacheDir, ORT_THREADS: '2' };

async function upload(h: Harness, bytes: Buffer, kind: 'IMAGE' | 'VIDEO', mimeType: string, extra: Record<string, unknown> = {}) {
  const token = await h.userToken(owner);
  const t = await h.http('POST', '/api/v1/media/uploads', { token, body: { kind, purpose: 'POST', mimeType, sizeBytes: bytes.length, ...extra }, headers: { 'idempotency-key': uuidv7() } });
  expect(t.status).toBe(201);
  expect((await fetch(t.body.uploadUrl, { method: 'PUT', headers: t.body.uploadHeaders, body: bytes })).status).toBe(200);
  expect((await h.http('POST', `/api/v1/media/${t.body.mediaId}/complete`, { token })).status).toBe(202);
  const id = t.body.mediaId as string;
  const asset = await waitFor(async () => {
    const r = await h.http('GET', `/api/v1/media/${id}`, { token });
    return r.body?.status !== 'PROCESSING' && r.body?.status !== 'PENDING_UPLOAD' ? r.body : false;
  });
  return { id, asset };
}
const doc = (h: Harness, id: string) => h.mongo.db(h.db).collection('mediaAssets').findOne({ _id: id as never });
const neutralPng = () => sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 40, g: 120, b: 200 } } }).png().toBuffer();

describe('preprocessing parity with training (fixtures generated in Python)', () => {
  it('sharp tensor ~ PIL tensor and ONNX probabilities match PyTorch', async () => {
    const registry = new S3ModelRegistry({ endpoint: S3, region: 'us-east-1', bucket: 'bandada-models', accessKeyId: 'media-svc', secretAccessKey: 'media_svc_dev_pw', forcePathStyle: true, cacheDir });
    const files = await registry.load('nsfw-classifier', '1.0.0', 'fp32');
    const clf = await OnnxImageClassifier.create(files.modelPath, files.metadata, 2);
    const cases = JSON.parse(readFileSync(join(FIX, 'cases.json'), 'utf8')) as { cases: { image: string; tensor: string; probs: number[] }[] };
    for (const c of cases.cases) {
      const ref = new Float32Array(gunzipSync(readFileSync(join(FIX, c.tensor))).buffer.slice(0));
      const got = await clf.preprocess(readFileSync(join(FIX, c.image)));
      expect(got.length).toBe(ref.length);
      let sum = 0;
      let max = 0;
      for (let i = 0; i < ref.length; i++) {
        const d = Math.abs(got[i]! - ref[i]!);
        sum += d;
        max = Math.max(max, d);
      }
      console.log(`${c.image}: mean|Δ|=${(sum / ref.length).toExponential(2)} max|Δ|=${max.toFixed(3)}`);
      expect(sum / ref.length).toBeLessThan(0.03);
      const probs = await clf.classifyTensor(got);
      expect(Math.abs(probs[1]! - c.probs[1]!)).toBeLessThan(0.03);
      // and the ONNX model on the exact reference tensor reproduces the PyTorch probabilities
      const exact = await clf.classifyTensor(ref);
      expect(Math.abs(exact[1]! - c.probs[1]!)).toBeLessThan(1e-4);
    }
  });
});

describe('MODERATION_MODE=onnx end to end (real model, MinIO, Mongo)', () => {
  it('APPROVED with persisted scores for a harmless image', async () => {
    const h = await startHarness('onnx', common);
    harnesses.push(h);
    const { id, asset } = await upload(h, await neutralPng(), 'IMAGE', 'image/png');
    expect(asset.status).toBe('APPROVED');
    const d = (await doc(h, id)) as unknown as { moderationResults: { model: string; modelVersion: string; scores: { nsfw: number }; decision: string }[] };
    expect(d.moderationResults[0]).toMatchObject({ model: 'nsfw-classifier', modelVersion: 'nsfw-classifier@1.0.0', decision: 'ALLOW' });
    expect(d.moderationResults[0]!.scores.nsfw).toBeLessThan(0.5);
    const ev = await h.mongo.db(h.db).collection('outbox').findOne({ 'payload.type': 'bandada.media.asset.approved.v1', 'payload.data.mediaId': id });
    expect(ev?.payload.data.modelVersion).toBe('nsfw-classifier@1.0.0');
    const ready = await h.http('GET', '/health/ready');
    expect(ready.body.moderation).toMatchObject({ mode: 'onnx', state: 'READY' });
  });

  it('REVIEW -> FLAGGED when the review threshold is 0 (forced), appears in the moderators queue', async () => {
    const h = await startHarness('onnx', { ...common, MODERATION_REVIEW_THRESHOLD: '0' });
    harnesses.push(h);
    const { id, asset } = await upload(h, await neutralPng(), 'IMAGE', 'image/png');
    expect(asset.status).toBe('FLAGGED');
    const svc = await h.serviceToken();
    const q = await h.http('GET', `/internal/v1/media?ownerId=${owner}`, { token: svc });
    expect(q.body.items.map((i: { id: string }) => i.id)).toContain(id);
    expect(await h.mongo.db(h.db).collection('outbox').countDocuments({ 'payload.type': 'bandada.media.asset.flagged.v1', 'payload.data.mediaId': id })).toBe(1);
  });

  it('BLOCK -> REJECTED automatically (asset.rejected, source AUTOMATIC) when both thresholds are 0', async () => {
    const h = await startHarness('onnx', { ...common, MODERATION_REVIEW_THRESHOLD: '0', MODERATION_BLOCK_THRESHOLD: '0' });
    harnesses.push(h);
    const { id, asset } = await upload(h, await neutralPng(), 'IMAGE', 'image/png');
    expect(asset.status).toBe('REJECTED');
    const ev = await h.mongo.db(h.db).collection('outbox').findOne({ 'payload.type': 'bandada.media.asset.rejected.v1', 'payload.data.mediaId': id });
    expect(ev?.payload.data).toMatchObject({ decision: 'BLOCK', source: 'AUTOMATIC' });
  });

  it('video: 1 frame every 2 s, score = max, frameScores and best-frame thumbnail', async () => {
    const h = await startHarness('onnx', common);
    harnesses.push(h);
    const dir = mkdtempSync(join(tmpdir(), 'vid-'));
    const file = join(dir, 'v.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=7:size=320x240:rate=10', '-pix_fmt', 'yuv420p', file]);
    const bytes = readFileSync(file);
    rmSync(dir, { recursive: true, force: true });
    const { id, asset } = await upload(h, bytes, 'VIDEO', 'video/mp4', { durationSeconds: 7 });
    expect(asset.status).toBe('APPROVED');
    const d = (await doc(h, id)) as unknown as { thumbnailKey: string; moderationResults: { frameScores: number[]; scores: { nsfw: number }; frameIndex: number }[] };
    const r = d.moderationResults[0]!;
    expect(r.frameScores).toHaveLength(4); // t = 0, 2, 4, 6 s
    expect(r.scores.nsfw).toBeCloseTo(Math.max(...r.frameScores), 5);
    expect(r.frameScores[r.frameIndex]).toBe(Math.max(...r.frameScores));
    expect(d.thumbnailKey).toMatch(/thumbnail\.jpg$/);
  });

  it('degrades to manual review (FLAGGED) and reports DEGRADED when the model version does not exist', async () => {
    const h = await startHarness('onnx', { ...common, MODEL_VERSION: '9.9.9', MODEL_CACHE_DIR: mkdtempSync(join(tmpdir(), 'empty-cache-')) });
    harnesses.push(h);
    const ready = await h.http('GET', '/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.moderation.state).toBe('DEGRADED');
    const { asset } = await upload(h, await neutralPng(), 'IMAGE', 'image/png');
    expect(asset.status).toBe('FLAGGED');
  });
});
