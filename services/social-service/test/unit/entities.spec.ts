import { DomainError } from '../../src/entities/errors/domain-error';
import { recencyScore } from '../../src/entities/policies/feed-recency.policy';
import { shouldAutoHide } from '../../src/entities/policies/report.policy';
import { Post } from '../../src/entities/post.entity';
import { Profile } from '../../src/entities/profile.entity';
import type { MediaAssetView } from '../../src/entities/value-objects/media';
import { extractHashtags } from '../../src/entities/value-objects/post-text';

const now = new Date('2026-10-14T12:00:00Z');
const A = '0192f1a2-3b4c-7d5e-8f60-718293a4b5c6';
const view = (id: string, status: MediaAssetView['status'], owner = A, kind: MediaAssetView['kind'] = 'IMAGE'): MediaAssetView => ({ mediaId: id, ownerId: owner, kind, status, updatedAt: now });
const create = (media: MediaAssetView[], text = 'hola #Calculo #calculo #x') =>
  Post.create({ id: 'p1', clientId: 'c1', authorId: A, text, visibility: 'PUBLIC', mediaIds: media.map((m) => m.mediaId), media }, now);

describe('Post', () => {
  it('extracts unique lowercase hashtags of 2+ chars', () => {
    expect(extractHashtags('hola #Calculo #calculo #x #álgebra_2')).toEqual(['calculo', 'álgebra_2']);
  });

  it('text-only post is PUBLISHED', () => expect(create([]).status).toBe('PUBLISHED'));

  it('post with unfinished media is PENDING_MEDIA and publishes only when ALL assets are approved', () => {
    const post = create([view('m1', 'PROCESSING'), view('m2', 'PROCESSING')]);
    expect(post.status).toBe('PENDING_MEDIA');
    const views = new Map([['m1', view('m1', 'APPROVED')], ['m2', view('m2', 'PROCESSING')]]);
    expect(post.applyMediaStatuses(views, now)).toBeNull();
    expect(post.status).toBe('PENDING_MEDIA');
    views.set('m2', view('m2', 'APPROVED'));
    expect(post.applyMediaStatuses(views, now)).toBe('published');
    expect(post.status).toBe('PUBLISHED');
  });

  it('flagged media hides the post and a moderator approval restores it', () => {
    const post = create([view('m1', 'PROCESSING')]);
    expect(post.applyMediaStatuses(new Map([['m1', view('m1', 'FLAGGED')]]), now)).toBe('hidden');
    expect(post.status).toBe('HIDDEN');
    expect(post.applyMediaStatuses(new Map([['m1', view('m1', 'APPROVED')]]), now)).toBe('published');
  });

  it('rejects foreign media, rejected media, empty posts and bad combinations', () => {
    expect(() => create([view('m1', 'APPROVED', 'other')])).toThrow(new DomainError('MEDIA_NOT_OWNED'));
    expect(() => create([view('m1', 'REJECTED')])).toThrow(new DomainError('MEDIA_REJECTED'));
    expect(() => create([], '  ')).toThrow(new DomainError('EMPTY_POST'));
    expect(() => create([view('a', 'APPROVED', A, 'VIDEO'), view('b', 'APPROVED')])).toThrow(new DomainError('INVALID_MEDIA_COMBINATION'));
  });

  it('moderation transitions are idempotent and REMOVED is final', () => {
    const post = create([]);
    expect(post.moderate('HIDDEN', now)).toBe(true);
    expect(post.moderate('HIDDEN', now)).toBe(false);
    expect(post.moderate('REMOVED', now)).toBe(true);
    expect(() => post.moderate('PUBLISHED', now)).toThrow(DomainError);
  });
});

describe('policies', () => {
  it('auto-hides at the threshold', () => {
    expect(shouldAutoHide(2, 3)).toBe(false);
    expect(shouldAutoHide(3, 3)).toBe(true);
  });
  it('recency score decays over 72 h', () => {
    expect(recencyScore(now, now)).toBe(1);
    expect(recencyScore(new Date(now.getTime() - 36 * 3_600_000), now)).toBe(0.5);
    expect(recencyScore(new Date(now.getTime() - 100 * 3_600_000), now)).toBe(0);
  });
});

describe('Profile.avatarStatus', () => {
  const fresh = () => Profile.register({ userId: A, displayName: 'Ana' }, now);
  it('is null without avatar, PENDING while under review, APPROVED once promoted', () => {
    const p = fresh();
    expect(p.snapshot.avatarStatus).toBeNull();
    p.setPendingAvatar('m1', now);
    expect(p.snapshot.avatarStatus).toBe('PENDING');
    expect(p.snapshot.avatarMediaId).toBeNull();
    p.promoteAvatar(now);
    expect(p.snapshot).toMatchObject({ avatarStatus: 'APPROVED', avatarMediaId: 'm1', pendingAvatarMediaId: null });
  });
  it('is REJECTED when the pending asset is discarded (previous avatar kept) and null when removed', () => {
    const p = fresh();
    p.setPendingAvatar('m1', now);
    p.promoteAvatar(now);
    p.setPendingAvatar('m2', now);
    p.discardPendingAvatar(now);
    expect(p.snapshot).toMatchObject({ avatarStatus: 'REJECTED', avatarMediaId: 'm1' });
    p.setPendingAvatar(null, now);
    expect(p.snapshot).toMatchObject({ avatarStatus: null, avatarMediaId: null });
  });
});
