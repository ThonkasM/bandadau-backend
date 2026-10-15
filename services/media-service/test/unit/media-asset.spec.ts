import { DomainError } from '../../src/entities/errors/domain-error';
import { MediaAsset, type NewUpload } from '../../src/entities/media-asset.entity';

const now = new Date('2026-10-14T12:00:00Z');
const limits = { maxImageBytes: 10_485_760, maxVideoBytes: 52_428_800 };
const base: NewUpload = { id: 'm1', ownerId: 'u1', kind: 'IMAGE', purpose: 'POST', mimeType: 'image/jpeg', sizeBytes: 1000, ttlSeconds: 900 };
const request = (o: Partial<NewUpload>) => MediaAsset.requestUpload({ ...base, ...o }, limits, now);

describe('MediaAsset', () => {
  it('creates a PENDING_UPLOAD asset with a private storage key', () => {
    const a = request({});
    expect(a.status).toBe('PENDING_UPLOAD');
    expect(a.snapshot.storageKey).toBe('media/u1/m1/original');
    expect(a.snapshot.uploadExpiresAt.getTime()).toBe(now.getTime() + 900_000);
  });

  it.each([
    [{ mimeType: 'video/mp4' }, 'UNSUPPORTED_MEDIA_TYPE'],
    [{ sizeBytes: 10_485_761 }, 'MEDIA_TOO_LARGE'],
    [{ purpose: 'AVATAR', kind: 'VIDEO', mimeType: 'video/mp4', durationSeconds: 5 }, 'UNSUPPORTED_MEDIA_TYPE'],
    [{ kind: 'VIDEO', mimeType: 'video/mp4', sizeBytes: 52_428_801, durationSeconds: 5 }, 'MEDIA_TOO_LARGE'],
    [{ kind: 'VIDEO', mimeType: 'video/mp4', durationSeconds: 61 }, 'VIDEO_TOO_LONG'],
    [{ kind: 'VIDEO', mimeType: 'video/mp4' }, 'VALIDATION_FAILED'],
  ] as const)('rejects %j with %s', (over, code) => {
    expect(() => request(over as Partial<NewUpload>)).toThrow(new DomainError(code));
  });

  it('accepts a video up to 50 MB and 60 s', () => {
    expect(request({ kind: 'VIDEO', mimeType: 'video/quicktime', sizeBytes: 52_428_800, durationSeconds: 60 }).snapshot.durationSeconds).toBe(60);
  });

  it('verifies the uploaded object against what was declared', () => {
    const a = request({});
    expect(() => a.verifyUpload(null, now)).toThrow(new DomainError('UPLOAD_MISSING'));
    expect(() => a.verifyUpload(null, new Date(now.getTime() + 901_000))).toThrow(new DomainError('UPLOAD_EXPIRED'));
    expect(() => a.verifyUpload({ size: 999, contentType: 'image/jpeg' }, now)).toThrow(new DomainError('UPLOAD_MISMATCH'));
    expect(() => a.verifyUpload({ size: 1000, contentType: 'image/png' }, now)).toThrow(new DomainError('UPLOAD_MISMATCH'));
    expect(() => a.verifyUpload({ size: 1000, contentType: 'image/jpeg' }, now)).not.toThrow();
  });

  it('human decision only applies to FLAGGED assets and is idempotent', () => {
    const a = request({});
    a.startProcessing(now);
    expect(() => a.decide('APPROVE', null, 'mod', now)).toThrow(new DomainError('MEDIA_NOT_FLAGGED'));
    a.applyModeration({ model: 'm', modelVersion: '1', labels: [], scores: { x: 0.6 }, decision: 'REVIEW', frameIndex: null, createdAt: now }, now);
    expect(a.status).toBe('FLAGGED');
    expect(a.decide('APPROVE', 'ok', 'mod', now)).toBe(true);
    expect(a.status).toBe('APPROVED');
    expect(a.decide('APPROVE', 'ok', 'mod', now)).toBe(false);
    expect(() => a.decide('REJECT', null, 'mod', now)).toThrow(new DomainError('MEDIA_NOT_FLAGGED'));
  });
});
