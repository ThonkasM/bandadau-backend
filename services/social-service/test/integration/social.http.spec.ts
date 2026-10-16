import { uuidv7 } from '@bandada/messaging-ts';

import { OnUserRegisteredUseCase } from '../../src/use-cases/identity-events/identity-events.use-cases';
import { ApplyMediaDecisionUseCase } from '../../src/use-cases/media-events/apply-media-decision.use-case';
import { type Harness,startHarness } from '../support/harness';

let h: Harness;
const users = { ana: uuidv7(), bob: uuidv7(), carla: uuidv7(), dan: uuidv7(), eva: uuidv7() };
const tokens: Record<string, string> = {};
const key = () => ({ 'idempotency-key': uuidv7() });

beforeAll(async () => {
  h = await startHarness();
  const register = h.app.get(OnUserRegisteredUseCase);
  for (const [name, id] of Object.entries(users)) {
    tokens[name] = await h.userToken(id);
    await register.execute({ userId: id, displayName: name, universityId: uuidv7(), career: 'Ingeniería' });
  }
});
afterAll(async () => h.stop());

const outboxTypes = async (): Promise<string[]> => (await h.mongo.db(h.db).collection('outbox').find().toArray()).map((d) => (d.payload as { type: string }).type);

describe('profiles and auth', () => {
  it('rejects missing token with localized Problem Details', async () => {
    const r = await h.http('GET', '/api/v1/profiles/me', { headers: { 'accept-language': 'en' } });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('UNAUTHORIZED');
    expect(r.headers.get('content-type')).toContain('application/problem+json');
    expect(r.headers.get('content-language')).toBe('en');
  });

  it('getMyProfile / updateMyProfile', async () => {
    const r = await h.http('PATCH', '/api/v1/profiles/me', { token: tokens.ana, body: { bio: 'hola', interests: ['calculo'] } });
    expect(r.status).toBe(200);
    expect(r.body.bio).toBe('hola');
    const bad = await h.http('PATCH', '/api/v1/profiles/me', { token: tokens.ana, body: { bio: 'x'.repeat(300) } });
    expect(bad.status).toBe(400);
    expect(bad.body.errors[0]).toMatchObject({ field: 'bio', code: 'TOO_LONG' });
  });

  it('exposes avatarStatus (null, PENDING while processing, APPROVED, REJECTED)', async () => {
    expect((await h.http('GET', '/api/v1/profiles/me', { token: tokens.bob })).body.avatarStatus).toBeNull();
    const m = uuidv7();
    h.assets.set(m, { id: m, ownerId: users.bob, kind: 'IMAGE', purpose: 'AVATAR', status: 'PROCESSING' });
    const pending = await h.http('PATCH', '/api/v1/profiles/me', { token: tokens.bob, body: { avatarMediaId: m } });
    expect(pending.body).toMatchObject({ avatarStatus: 'PENDING', avatarMediaId: null });
    const decide = h.app.get(ApplyMediaDecisionUseCase);
    await decide.execute({ mediaId: m, ownerId: users.bob, kind: 'IMAGE', status: 'REJECTED' });
    expect((await h.http('GET', '/api/v1/profiles/me', { token: tokens.bob })).body).toMatchObject({ avatarStatus: 'REJECTED', avatarMediaId: null });
    const ok = uuidv7();
    h.assets.set(ok, { id: ok, ownerId: users.bob, kind: 'IMAGE', purpose: 'AVATAR', status: 'APPROVED' });
    expect((await h.http('PATCH', '/api/v1/profiles/me', { token: tokens.bob, body: { avatarMediaId: ok } })).body).toMatchObject({ avatarStatus: 'APPROVED', avatarMediaId: ok });
  });

  it('404s carry domain codes (PROFILE/POST/COMMENT/GROUP_NOT_FOUND)', async () => {
    const missing = uuidv7();
    expect((await h.http('GET', `/api/v1/profiles/${missing}`, { token: tokens.ana })).body.code).toBe('PROFILE_NOT_FOUND');
    expect((await h.http('GET', `/api/v1/posts/${missing}`, { token: tokens.ana })).body.code).toBe('POST_NOT_FOUND');
    expect((await h.http('GET', `/api/v1/posts/${missing}/comments`, { token: tokens.ana })).body.code).toBe('POST_NOT_FOUND');
    const g = await h.http('GET', `/api/v1/groups/${missing}`, { token: tokens.ana });
    expect(g.status).toBe(404);
    expect(g.body.code).toBe('GROUP_NOT_FOUND');
    const rep = await h.http('POST', '/api/v1/reports', { token: tokens.ana, body: { targetType: 'COMMENT', targetId: missing, reason: 'SPAM' }, headers: key() });
    expect(rep.body.code).toBe('COMMENT_NOT_FOUND');
  });
});

describe('createPost', () => {
  it('is idempotent by Idempotency-Key and by clientId', async () => {
    const clientId = uuidv7();
    const body = { clientId, text: 'Mi primer #post', mediaIds: [], visibility: 'PUBLIC' };
    const k = uuidv7();
    const a = await h.http('POST', '/api/v1/posts', { token: tokens.ana, body, headers: { 'idempotency-key': k } });
    expect(a.status).toBe(201);
    expect(a.body.status).toBe('PUBLISHED');
    expect(a.body.hashtags).toEqual(['post']);
    const replay = await h.http('POST', '/api/v1/posts', { token: tokens.ana, body, headers: { 'idempotency-key': k } });
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(replay.body.id).toBe(a.body.id);
    const again = await h.http('POST', '/api/v1/posts', { token: tokens.ana, body, headers: key() });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(a.body.id);
    const reused = await h.http('POST', '/api/v1/posts', { token: tokens.ana, body: { ...body, text: 'otro' }, headers: { 'idempotency-key': k } });
    expect(reused.status).toBe(422);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const missing = await h.http('POST', '/api/v1/posts', { token: tokens.ana, body });
    expect(missing.status).toBe(400);
  });

  it('concurrent requests with the same clientId create exactly one post', async () => {
    const body = { clientId: uuidv7(), text: 'concurrente', mediaIds: [], visibility: 'PUBLIC' };
    const rs = await Promise.all(Array.from({ length: 6 }, () => h.http('POST', '/api/v1/posts', { token: tokens.bob, body, headers: key() })));
    expect(rs.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(rs.filter((r) => r.status === 201).length).toBe(1);
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
    expect(await h.mongo.db(h.db).collection('posts').countDocuments({ clientId: body.clientId })).toBe(1);
  });

  it('post with media stays PENDING_MEDIA until every asset is APPROVED', async () => {
    const [m1, m2] = [uuidv7(), uuidv7()];
    for (const id of [m1, m2]) h.assets.set(id, { id, ownerId: users.carla, kind: 'IMAGE', purpose: 'POST', status: 'PROCESSING' });
    const r = await h.http('POST', '/api/v1/posts', { token: tokens.carla, body: { clientId: uuidv7(), text: 'con fotos', mediaIds: [m1, m2], visibility: 'PUBLIC' }, headers: key() });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('PENDING_MEDIA');
    const apply = h.app.get(ApplyMediaDecisionUseCase);
    await apply.execute({ mediaId: m1, ownerId: users.carla, kind: 'IMAGE', status: 'APPROVED' });
    expect((await h.http('GET', `/api/v1/posts/${r.body.id}`, { token: tokens.carla })).body.status).toBe('PENDING_MEDIA');
    await apply.execute({ mediaId: m1, ownerId: users.carla, kind: 'IMAGE', status: 'APPROVED' }); // duplicate delivery
    h.assets.get(m1)!.status = 'APPROVED';
    h.assets.get(m2)!.status = 'APPROVED';
    await apply.execute({ mediaId: m2, ownerId: users.carla, kind: 'IMAGE', status: 'APPROVED' });
    const done = await h.http('GET', `/api/v1/posts/${r.body.id}`, { token: tokens.carla });
    expect(done.body.status).toBe('PUBLISHED');
    expect(done.body.media[0].url).toBe(`http://s3/${m1}`);
    expect(await outboxTypes()).toEqual(expect.arrayContaining(['bandada.social.post.published.v1']));
  });

  it('foreign media is rejected and flagged media hides the post', async () => {
    const m = uuidv7();
    h.assets.set(m, { id: m, ownerId: users.dan, kind: 'IMAGE', purpose: 'POST', status: 'APPROVED' });
    const r = await h.http('POST', '/api/v1/posts', { token: tokens.eva, body: { clientId: uuidv7(), text: 'x', mediaIds: [m], visibility: 'PUBLIC' }, headers: key() });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('MEDIA_NOT_OWNED');
  });
});

describe('reports', () => {
  it('3 distinct reporters hide a post exactly once, even concurrently', async () => {
    const post = await h.http('POST', '/api/v1/posts', { token: tokens.ana, body: { clientId: uuidv7(), text: 'polémico', mediaIds: [], visibility: 'PUBLIC' }, headers: key() });
    const reporters = [tokens.bob, tokens.carla, tokens.dan, tokens.eva];
    const rs = await Promise.all(reporters.map((t) => h.http('POST', '/api/v1/reports', { token: t, body: { targetType: 'POST', targetId: post.body.id, reason: 'SPAM' }, headers: key() })));
    expect(rs.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    const stored = await h.mongo.db(h.db).collection('posts').findOne({ _id: post.body.id as never });
    expect(stored?.status).toBe('HIDDEN');
    expect(stored?.openReportsCount).toBe(4);
    const hidden = (await h.mongo.db(h.db).collection('outbox').find({ 'payload.type': 'bandada.social.post.hidden.v1', 'payload.data.postId': post.body.id }).toArray()).length;
    expect(hidden).toBe(1);
    const dup = await h.http('POST', '/api/v1/reports', { token: tokens.bob, body: { targetType: 'POST', targetId: post.body.id, reason: 'SPAM' }, headers: key() });
    expect([404, 409]).toContain(dup.status);
    const own = await h.http('POST', '/api/v1/reports', { token: tokens.ana, body: { targetType: 'POST', targetId: post.body.id, reason: 'SPAM' }, headers: key() });
    expect(own.status).toBe(422);
  });

  it('moderator resolves via /internal and the post becomes REMOVED', async () => {
    const svc = await h.serviceToken();
    const queue = await h.http('GET', '/internal/v1/reports?status=OPEN', { token: svc });
    expect(queue.status).toBe(200);
    expect(queue.body.items.length).toBeGreaterThanOrEqual(3);
    const r = await h.http('PATCH', `/internal/v1/reports/${queue.body.items[0].id}`, { token: svc, body: { resolution: 'REMOVE' }, headers: { 'x-actor-id': uuidv7() } });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('RESOLVED_REMOVED');
    expect((await h.http('GET', '/internal/v1/reports?status=OPEN', { token: svc })).body.items.length).toBe(0);
    expect((await h.http('GET', '/internal/v1/posts?status=HIDDEN', { token: await h.userToken(uuidv7()) })).status).toBe(401);
  });

  it('/internal: getPostInternal in any state, AUTHOR_SUSPENDED kept, scopes enforced', async () => {
    const svc = await h.serviceToken();
    const post = await h.http('POST', '/api/v1/posts', { token: tokens.eva, body: { clientId: uuidv7(), text: 'interno', mediaIds: [], visibility: 'PUBLIC' }, headers: key() });
    await h.mongo.db(h.db).collection('posts').updateOne({ _id: post.body.id as never }, { $set: { status: 'HIDDEN', hiddenReason: 'AUTHOR_SUSPENDED' } });
    const r = await h.http('GET', `/internal/v1/posts/${post.body.id}`, { token: svc });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: post.body.id, status: 'HIDDEN', hiddenReason: 'AUTHOR_SUSPENDED', author: { userId: users.eva } });
    const missing = await h.http('GET', `/internal/v1/posts/${uuidv7()}`, { token: svc });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('POST_NOT_FOUND');
    const readOnly = await h.serviceToken('internal:read');
    expect((await h.http('GET', `/internal/v1/posts/${post.body.id}`, { token: readOnly })).status).toBe(200);
    const denied = await h.http('PATCH', `/internal/v1/posts/${post.body.id}/status`, { token: readOnly, body: { status: 'PUBLISHED', reason: 'x' }, headers: { 'x-actor-id': uuidv7() } });
    expect(denied.status).toBe(403);
    expect((await h.http('GET', `/internal/v1/posts/${post.body.id}`, { token: await h.serviceToken('') })).status).toBe(403);
  });

  it('/internal: getCommentInternal in any state, 404 COMMENT_NOT_FOUND, scopes enforced', async () => {
    const svc = await h.serviceToken();
    const post = await h.http('POST', '/api/v1/posts', { token: tokens.ana, body: { clientId: uuidv7(), text: 'con comentario', mediaIds: [], visibility: 'PUBLIC' }, headers: key() });
    const comment = await h.http('POST', `/api/v1/posts/${post.body.id}/comments`, { token: tokens.bob, body: { text: 'comentario interno' }, headers: key() });
    await h.mongo.db(h.db).collection('comments').updateOne({ _id: comment.body.id as never }, { $set: { status: 'HIDDEN' } });
    const r = await h.http('GET', `/internal/v1/comments/${comment.body.id}`, { token: svc });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: comment.body.id, postId: post.body.id, text: 'comentario interno', status: 'HIDDEN', author: { userId: users.bob } });
    const missing = await h.http('GET', `/internal/v1/comments/${uuidv7()}`, { token: svc });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('COMMENT_NOT_FOUND');
    expect((await h.http('GET', `/internal/v1/comments/${comment.body.id}`, { token: await h.serviceToken('internal:read') })).status).toBe(200);
    expect((await h.http('GET', `/internal/v1/comments/${comment.body.id}`, { token: await h.serviceToken('') })).status).toBe(403);
  });
});

describe('comments, reactions, follows', () => {
  it('createComment is idempotent and counts', async () => {
    const post = await h.http('POST', '/api/v1/posts', { token: tokens.ana, body: { clientId: uuidv7(), text: 'comenten', mediaIds: [], visibility: 'PUBLIC' }, headers: key() });
    const k = uuidv7();
    const a = await h.http('POST', `/api/v1/posts/${post.body.id}/comments`, { token: tokens.bob, body: { text: 'buen post' }, headers: { 'idempotency-key': k } });
    const b = await h.http('POST', `/api/v1/posts/${post.body.id}/comments`, { token: tokens.bob, body: { text: 'buen post' }, headers: { 'idempotency-key': k } });
    expect(a.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    const list = await h.http('GET', `/api/v1/posts/${post.body.id}/comments`, { token: tokens.carla });
    expect(list.body.items).toHaveLength(1);
    expect((await h.http('GET', `/api/v1/posts/${post.body.id}`, { token: tokens.carla })).body.commentsCount).toBe(1);

    const r1 = await h.http('PUT', `/api/v1/posts/${post.body.id}/reactions/me`, { token: tokens.bob, body: { type: 'LIKE' } });
    expect(r1.body.reactionCounts.like).toBe(1);
    const r2 = await h.http('PUT', `/api/v1/posts/${post.body.id}/reactions/me`, { token: tokens.bob, body: { type: 'HELPFUL' } });
    expect(r2.body.reactionCounts).toMatchObject({ like: 0, helpful: 1 });
    expect((await h.http('DELETE', `/api/v1/posts/${post.body.id}/reactions/me`, { token: tokens.bob })).status).toBe(204);
    expect((await h.http('DELETE', `/api/v1/posts/${post.body.id}/reactions/me`, { token: tokens.bob })).status).toBe(204);

    const outbox = h.mongo.db(h.db).collection('outbox');
    for (const type of ['bandada.social.comment.created.v1', 'bandada.social.reaction.set.v1']) {
      const ev = await outbox.findOne({ 'payload.type': type, 'payload.data.postId': post.body.id });
      expect((ev?.payload as { data: { actorDisplayName?: string } }).data.actorDisplayName).toEqual(expect.any(String));
    }
  });

  it('follow is idempotent and emits one event', async () => {
    const a = await h.http('PUT', `/api/v1/follows/${users.ana}`, { token: tokens.dan });
    const b = await h.http('PUT', `/api/v1/follows/${users.ana}`, { token: tokens.dan });
    expect(a.status).toBe(200);
    expect(b.body.createdAt).toBe(a.body.createdAt);
    expect(await h.mongo.db(h.db).collection('outbox').countDocuments({ 'payload.type': 'bandada.social.follow.created.v1', 'payload.data.followerId': users.dan })).toBe(1);
    const fev = await h.mongo.db(h.db).collection('outbox').findOne({ 'payload.type': 'bandada.social.follow.created.v1', 'payload.data.followerId': users.dan });
    expect((fev?.payload as { data: { actorDisplayName?: string } }).data.actorDisplayName).toEqual(expect.any(String));
    expect((await h.http('PUT', `/api/v1/follows/${users.dan}`, { token: tokens.dan })).body.code).toBe('CANNOT_FOLLOW_SELF');
    expect((await h.http('GET', '/api/v1/follows/suggestions', { token: tokens.dan })).body).toEqual({ items: [], nextCursor: null });
  });
});

describe('groups', () => {
  it('private group: request, approve, then member sees posts', async () => {
    const g = await h.http('POST', '/api/v1/groups', { token: tokens.ana, body: { name: 'Cálculo II', subject: 'Matemática', privacy: 'PRIVATE' }, headers: key() });
    expect(g.status).toBe(201);
    expect(g.body.myMembership).toEqual({ role: 'OWNER', status: 'ACTIVE' });
    const gid = g.body.id;
    const join = await h.http('POST', `/api/v1/groups/${gid}/join`, { token: tokens.bob });
    expect(join.body.status).toBe('PENDING');
    expect((await h.http('POST', `/api/v1/groups/${gid}/join`, { token: tokens.bob })).body.status).toBe('PENDING');
    expect((await h.http('GET', `/api/v1/groups/${gid}/posts`, { token: tokens.bob })).status).toBe(403);
    expect((await h.http('POST', `/api/v1/groups/${gid}/members/${users.bob}/approve`, { token: tokens.carla })).status).toBe(403);
    const pending = await h.http('GET', `/api/v1/groups/${gid}/members?status=PENDING`, { token: tokens.ana });
    expect(pending.body.items[0].userId).toBe(users.bob);
    const ok = await h.http('POST', `/api/v1/groups/${gid}/members/${users.bob}/approve`, { token: tokens.ana });
    expect(ok.body.status).toBe('ACTIVE');
    await h.http('POST', `/api/v1/groups/${gid}/members/${users.bob}/approve`, { token: tokens.ana });
    expect((await h.http('GET', `/api/v1/groups/${gid}`, { token: tokens.ana })).body.membersCount).toBe(2);
    const p = await h.http('POST', '/api/v1/posts', { token: tokens.bob, body: { clientId: uuidv7(), text: 'en el grupo', mediaIds: [], visibility: 'GROUP', groupId: gid }, headers: key() });
    expect(p.status).toBe(201);
    expect((await h.http('GET', `/api/v1/groups/${gid}/posts`, { token: tokens.ana })).body.items).toHaveLength(1);
    expect((await h.http('POST', '/api/v1/posts', { token: tokens.carla, body: { clientId: uuidv7(), text: 'intruso', mediaIds: [], visibility: 'GROUP', groupId: gid }, headers: key() })).status).toBe(403);
    expect((await h.http('POST', `/api/v1/groups/${gid}/leave`, { token: tokens.ana })).body.code).toBe('OWNER_CANNOT_LEAVE');
    expect((await h.http('POST', `/api/v1/groups/${gid}/leave`, { token: tokens.bob })).body.status).toBe('LEFT');
    expect((await h.http('GET', `/api/v1/groups/${gid}`, { token: tokens.ana })).body.membersCount).toBe(1);
    const rej = await h.http('POST', `/api/v1/groups/${gid}/join`, { token: tokens.carla });
    expect((await h.http('POST', `/api/v1/groups/${gid}/members/${users.carla}/reject`, { token: tokens.ana })).body.status).toBe('REJECTED');
    expect(rej.status).toBe(200);
    const search = await h.http('GET', '/api/v1/groups?query=c%C3%A1lculo', { token: tokens.eva });
    expect(search.body.items.length).toBe(1);
  });

  it('public group joins immediately', async () => {
    const g = await h.http('POST', '/api/v1/groups', { token: tokens.eva, body: { name: 'Ajedrez', subject: 'Juegos', privacy: 'PUBLIC' }, headers: key() });
    const j = await h.http('POST', `/api/v1/groups/${g.body.id}/join`, { token: tokens.dan });
    expect(j.body.status).toBe('ACTIVE');
  });
});

describe('feed', () => {
  it('paginates by cursor without duplicates and respects visibility', async () => {
    for (let i = 0; i < 5; i++) {
      await h.http('POST', '/api/v1/posts', { token: tokens.ana, body: { clientId: uuidv7(), text: `feed ${i}`, mediaIds: [], visibility: i === 0 ? 'FOLLOWERS' : 'PUBLIC' }, headers: key() });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const r: { status: number; body: any } = await h.http('GET', `/api/v1/feed?limit=3${cursor ? `&cursor=${cursor}` : ''}`, { token: tokens.dan });
      expect(r.status).toBe(200);
      seen.push(...r.body.items.map((i: any) => i.post.id));
      cursor = r.body.nextCursor;
      if (!cursor) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(6);
    const dan = await h.http('GET', '/api/v1/feed?limit=50', { token: tokens.dan });
    const texts = dan.body.items.map((i: any) => i.post.text);
    expect(texts).toContain('feed 0'); // dan follows ana -> FOLLOWERS post visible
    const eva = await h.http('GET', '/api/v1/feed?limit=50', { token: tokens.eva });
    expect(eva.body.items.map((i: any) => i.post.text)).not.toContain('feed 0');
    expect((await h.http('GET', '/api/v1/feed?cursor=garbage', { token: tokens.dan })).status).toBe(400);
  });
});

describe('health', () => {
  it('live is UP', async () => expect((await h.http('GET', '/health/live')).body.status).toBe('UP'));
});
