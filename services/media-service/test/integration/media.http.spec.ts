import { uuidv7 } from '@bandada/messaging-ts';
import sharp from 'sharp';

import { OnPostDeletedUseCase } from '../../src/use-cases/post-events.use-case';
import { type Harness,startHarness } from '../support/harness';

const owner = uuidv7();
const other = uuidv7();
const key = () => ({ 'idempotency-key': uuidv7() });
const waitFor = async <T>(fn: () => Promise<T | undefined | false>, ms = 8000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 100));
  }
};

let auto: Harness;
let manual: Harness;
let png: Buffer;
const uploaded: string[] = [];

beforeAll(async () => {
  auto = await startHarness('allow-all');
  manual = await startHarness('manual');
  png = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();
});
afterAll(async () => {
  await auto.stop();
  await manual.stop();
});

async function upload(h: Harness, token: string, bytes: Buffer, over: Record<string, unknown> = {}) {
  const t = await h.http('POST', '/api/v1/media/uploads', { token, body: { kind: 'IMAGE', purpose: 'POST', mimeType: 'image/png', sizeBytes: bytes.length, fileName: 'a.png', ...over }, headers: key() });
  expect(t.status).toBe(201);
  uploaded.push(t.body.mediaId);
  const put = await fetch(t.body.uploadUrl, { method: 'PUT', headers: t.body.uploadHeaders, body: bytes });
  expect(put.status).toBe(200);
  return t.body.mediaId as string;
}

describe('createUpload', () => {
  it('returns a presigned PUT on the public endpoint and is idempotent', async () => {
    const token = await auto.userToken(owner);
    const k = uuidv7();
    const body = { kind: 'IMAGE', mimeType: 'image/png', sizeBytes: png.length };
    const a = await auto.http('POST', '/api/v1/media/uploads', { token, body, headers: { 'idempotency-key': k } });
    expect(a.status).toBe(201);
    expect(a.body.uploadMethod).toBe('PUT');
    expect(a.body.uploadUrl).toContain('http://localhost:9000/bandada-media/media/');
    expect(a.body.uploadUrl).toContain('X-Amz-Signature');
    expect(a.body.expiresIn).toBe(900);
    const b = await auto.http('POST', '/api/v1/media/uploads', { token, body, headers: { 'idempotency-key': k } });
    expect(b.body.mediaId).toBe(a.body.mediaId);
    expect(b.headers.get('idempotent-replayed')).toBe('true');
  });

  it.each([
    [{ kind: 'IMAGE', mimeType: 'image/png', sizeBytes: 10_485_761 }, 422, 'MEDIA_TOO_LARGE'],
    [{ kind: 'IMAGE', mimeType: 'video/mp4', sizeBytes: 10 }, 422, 'UNSUPPORTED_MEDIA_TYPE'],
    [{ kind: 'VIDEO', mimeType: 'video/mp4', sizeBytes: 10 }, 400, 'VALIDATION_FAILED'],
    [{ kind: 'IMAGE', mimeType: 'image/gif', sizeBytes: 10 }, 400, 'VALIDATION_FAILED'],
  ])('rejects %j', async (body, status, code) => {
    const r = await auto.http('POST', '/api/v1/media/uploads', { token: await auto.userToken(owner), body, headers: key() });
    expect(r.status).toBe(status);
    expect(r.body.code).toBe(code);
  });
});

describe('completeUpload (allow-all)', () => {
  it('verifies the object, answers 202 and ends APPROVED with a thumbnail and an approved event', async () => {
    const token = await auto.userToken(owner);
    const id = await upload(auto, token, png);
    const done = await auto.http('POST', `/api/v1/media/${id}/complete`, { token });
    expect(done.status).toBe(202);
    expect(done.body.status).toBe('PROCESSING');
    const approved = await waitFor(async () => {
      const r = await auto.http('GET', `/api/v1/media/${id}`, { token });
      return r.body.status === 'APPROVED' && r.body;
    });
    expect(approved.thumbnailUrl).toContain('thumbnail.jpg');
    const get = await fetch(approved.url);
    expect(get.status).toBe(200);
    expect((await get.arrayBuffer()).byteLength).toBe(png.length);
    const events = await auto.mongo.db(auto.db).collection('outbox').find({ 'payload.type': 'bandada.media.asset.approved.v1', 'payload.data.mediaId': id }).toArray();
    expect(events).toHaveLength(1);
    expect((events[0]!.payload as any).data).toMatchObject({ ownerId: owner, kind: 'IMAGE', decision: 'ALLOW' });
    const again = await auto.http('POST', `/api/v1/media/${id}/complete`, { token });
    expect(again.status).toBe(202);
    expect(again.body.status).toBe('APPROVED');
    expect(await auto.mongo.db(auto.db).collection('outbox').countDocuments({ 'payload.data.mediaId': id })).toBe(1);
    expect((await auto.http('GET', `/api/v1/media/${id}`, { token: await auto.userToken(other) })).status).toBe(200); // approved is public
    expect((await auto.http('POST', `/api/v1/media/${id}/complete`, { token: await auto.userToken(other) })).status).toBe(403);
  });

  it('fails when the object is missing or does not match', async () => {
    const token = await auto.userToken(owner);
    const t = await auto.http('POST', '/api/v1/media/uploads', { token, body: { kind: 'IMAGE', mimeType: 'image/png', sizeBytes: png.length }, headers: key() });
    const missing = await auto.http('POST', `/api/v1/media/${t.body.mediaId}/complete`, { token });
    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe('UPLOAD_MISSING');
    await fetch(t.body.uploadUrl, { method: 'PUT', headers: t.body.uploadHeaders, body: Buffer.concat([png, Buffer.from('x')]) });
    uploaded.push(t.body.mediaId);
    const mismatch = await auto.http('POST', `/api/v1/media/${t.body.mediaId}/complete`, { token });
    expect(mismatch.body.code).toBe('UPLOAD_MISMATCH');
  });

  it('rejects an object whose magic bytes contradict the declared Content-Type (D-12)', async () => {
    const token = await auto.userToken(owner);
    const fake = Buffer.from('<html><body>not a png</body></html>');
    const t = await auto.http('POST', '/api/v1/media/uploads', { token, body: { kind: 'IMAGE', mimeType: 'image/png', sizeBytes: fake.length }, headers: key() });
    const put = await fetch(t.body.uploadUrl, { method: 'PUT', headers: t.body.uploadHeaders, body: fake });
    expect(put.status).toBe(200);
    uploaded.push(t.body.mediaId);
    const r = await auto.http('POST', `/api/v1/media/${t.body.mediaId}/complete`, { token });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('MEDIA_CONTENT_MISMATCH');
    const doc = await auto.mongo.db(auto.db).collection('mediaAssets').findOne({ id: t.body.mediaId } as any) ?? await auto.mongo.db(auto.db).collection('mediaAssets').findOne({ _id: t.body.mediaId } as any);
    expect(doc?.status).toBe('PENDING_UPLOAD');
    expect(await auto.mongo.db(auto.db).collection('outbox').countDocuments({ 'payload.data.mediaId': t.body.mediaId })).toBe(0);
  });
});

describe('manual moderation', () => {
  it('flags the asset, lists it in the queue and decideMedia publishes approved/rejected', async () => {
    const token = await manual.userToken(owner);
    const svc = await manual.serviceToken();
    const [a, b] = [await upload(manual, token, png), await upload(manual, token, png)];
    for (const id of [a, b]) expect((await manual.http('POST', `/api/v1/media/${id}/complete`, { token })).status).toBe(202);
    await waitFor(async () => (await manual.http('GET', `/api/v1/media/${b}`, { token })).body.status === 'FLAGGED');
    await waitFor(async () => (await manual.http('GET', `/api/v1/media/${a}`, { token })).body.status === 'FLAGGED');
    const mine = await manual.http('GET', `/api/v1/media/${a}`, { token });
    expect(mine.body.url).toContain('X-Amz-Signature'); // the owner sees their own asset in any state
    expect((await manual.http('GET', `/api/v1/media/${a}`, { token: await manual.userToken(other) })).status).toBe(404);
    const flagged = await manual.mongo.db(manual.db).collection('outbox').countDocuments({ 'payload.type': 'bandada.media.asset.flagged.v1' });
    expect(flagged).toBe(2);

    const queue = await manual.http('GET', `/internal/v1/media?ownerId=${owner}`, { token: svc });
    expect(queue.status).toBe(200);
    expect(queue.body.items.map((i: any) => i.id).sort()).toEqual([a, b].sort());
    expect(queue.body.items[0].moderationResults[0].decision).toBe('REVIEW');
    expect((await manual.http('GET', '/internal/v1/media', { token })).status).toBe(401);

    const actor = { 'x-actor-id': uuidv7() };
    const ok = await manual.http('POST', `/internal/v1/media/${a}/decision`, { token: svc, body: { decision: 'APPROVE' }, headers: actor });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('APPROVED');
    expect((await manual.http('POST', `/internal/v1/media/${a}/decision`, { token: svc, body: { decision: 'APPROVE' }, headers: actor })).status).toBe(200);
    expect((await manual.http('POST', `/internal/v1/media/${a}/decision`, { token: svc, body: { decision: 'REJECT' }, headers: actor })).body.code).toBe('MEDIA_NOT_FLAGGED');
    const rej = await manual.http('POST', `/internal/v1/media/${b}/decision`, { token: svc, body: { decision: 'REJECT', note: 'no' }, headers: actor });
    expect(rej.body.status).toBe('REJECTED');
    const types = (await manual.mongo.db(manual.db).collection('outbox').find().toArray()).map((d: any) => d.payload.type);
    expect(types.filter((t: string) => t.endsWith('approved.v1'))).toHaveLength(1);
    expect(types.filter((t: string) => t.endsWith('rejected.v1'))).toHaveLength(1);

    const urls = await manual.http('GET', `/internal/v1/media/urls?ids=${a}&ids=${b}&ids=${uuidv7()}`, { token: svc });
    expect(urls.body.items).toHaveLength(2);
    const byId = Object.fromEntries(urls.body.items.map((i: any) => [i.mediaId, i]));
    expect(byId[a].url).toContain('X-Amz-Signature');
    expect(byId[b].url).toBeNull();
    const internal = await manual.http('GET', `/internal/v1/media/${b}`, { token: svc });
    expect(internal.body.url).toContain('X-Amz-Signature');
    expect(internal.body.finalDecision).toMatchObject({ decision: 'REJECT', note: 'no' });
  });
});

describe('post.deleted cleanup', () => {
  it('deletes objects of the author media', async () => {
    const token = await auto.userToken(owner);
    const id = await upload(auto, token, png);
    const use = auto.app.get(OnPostDeletedUseCase);
    expect(await use.execute({ authorId: other, mediaIds: [id] })).toBe(0);
    expect(await use.execute({ authorId: owner, mediaIds: [id] })).toBe(1);
    expect((await auto.http('GET', `/api/v1/media/${id}`, { token })).status).toBe(404);
  });
});
