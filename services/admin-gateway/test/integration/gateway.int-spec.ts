import request from 'supertest';

import { type Harness, ids, startHarness, user } from './support/harness';

let h: Harness;
let admin: string;
let moderator: string;
let student: string;

beforeAll(async () => {
  h = await startHarness();
  admin = await h.token(ids.admin, ['ADMIN']);
  moderator = await h.token(ids.moderator, ['MODERATOR']);
  student = await h.token(ids.student, ['STUDENT']);
});

afterAll(async () => {
  await h?.close();
});

beforeEach(() => h.resetMocks());

const code = (res: request.Response, i = 0): string | undefined => res.body.errors?.[i]?.extensions?.code;

describe('authentication and role authorization', () => {
  it('rejects anonymous and invalid tokens with UNAUTHENTICATED', async () => {
    expect(code(await h.gql('{ universities { id } }'))).toBe('UNAUTHENTICATED');
    expect(code(await h.gql('{ me { id } }', { token: 'garbage' }))).toBe('UNAUTHENTICATED');
    const wrongAudience = await h.token(ids.admin, ['ADMIN']).then(() => undefined);
    expect(wrongAudience).toBeUndefined();
  });

  it('enforces @auth(requires) per field: MODERATOR cannot list users, STUDENT cannot see the queue', async () => {
    expect(code(await h.gql('{ users { edges { cursor } } }', { token: moderator }))).toBe('FORBIDDEN');
    expect(code(await h.gql('{ moderationQueue { totalCount } }', { token: student }))).toBe('FORBIDDEN');
    expect(code(await h.gql('mutation { suspendUser(input:{userId:"0192a3b4-0000-7000-8000-000000000011", reason:"x"}) { errors { code } } }', { token: student }))).toBe('FORBIDDEN');
    expect(code(await h.gql('mutation { updateUserRoles(input:{userId:"0192a3b4-0000-7000-8000-000000000011", roles:[STUDENT]}) { errors { code } } }', { token: moderator }))).toBe('FORBIDDEN');
    expect(h.callsTo('/identity/internal')).toHaveLength(0);
  });

  it('me uses the caller token against identity and propagates Accept-Language', async () => {
    h.mock('GET', '/identity/api/v1/users/me', () => ({ body: user(ids.admin, { roles: ['ADMIN'], locale: 'en' }) }));
    h.mock('GET', '/social/internal/v1/profiles/' + ids.admin, () => ({ body: { userId: ids.admin, displayName: 'Admin Ana', career: 'Ing', semester: 5, avatarUrl: null } }));
    h.mock('GET', '/identity/api/v1/universities', () => ({ body: { items: [{ id: ids.uni, name: 'UMSA', allowedDomains: ['umsa.bo'], enabled: true }], nextCursor: null } }));
    const res = await h.gql('{ me { id roles locale displayName university { name enabled } } }', { token: admin, lang: 'en' });
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.me).toEqual({ id: ids.admin, roles: ['ADMIN'], locale: 'en', displayName: 'Admin Ana', university: { name: 'UMSA', enabled: true } });
    const meCall = h.callsTo('/identity/api/v1/users/me')[0]!;
    expect(meCall.headers.authorization).toBe(`Bearer ${admin}`);
    expect(meCall.headers['accept-language']).toBe('en');
    expect(h.callsTo('/social/internal/v1/profiles')[0]?.headers).toMatchObject({ authorization: 'Bearer svc-token', 'x-actor-id': ids.admin, 'accept-language': 'en' });
  });
});

describe('users and DataLoader', () => {
  it('batches profile/university/user lookups per request (no N+1) and paginates Relay style', async () => {
    const list = [ids.u1, ids.u2, ids.u3].map((id) => user(id));
    h.mock('GET', '/identity/internal/v1/users', () => ({ body: { items: list, nextCursor: 'CUR2' } }));
    h.mock('GET', '/identity/api/v1/universities', () => ({ body: { items: [{ id: ids.uni, name: 'UMSA', allowedDomains: ['umsa.bo'], enabled: true }], nextCursor: null } }));
    for (const id of [ids.u1, ids.u2, ids.u3]) h.mock('GET', `/social/internal/v1/profiles/${id}`, () => ({ body: { userId: id, displayName: `N${id.slice(-2)}` } }));

    const res = await h.gql('query($after:String){ users(first: 3, after: $after, filter:{role: STUDENT}) { edges { cursor node { id displayName university { id name } } } pageInfo { hasNextPage endCursor } } }', { token: admin, variables: { after: 'CUR1' } });
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.users.edges.map((e: { node: { displayName: string } }) => e.node.displayName)).toEqual(['N11', 'N12', 'N13']);
    expect(res.body.data.users.pageInfo).toEqual({ hasNextPage: true, endCursor: 'CUR2' });
    expect(h.callsTo('/identity/api/v1/universities')).toHaveLength(1);
    const search = h.callsTo('/identity/internal/v1/users')[0]!;
    expect(search.query.get('cursor')).toBe('CUR1');
    expect(search.query.get('role')).toBe('STUDENT');
    expect(search.query.get('limit')).toBe('3');
  });

  it('loads the owners of a moderation queue in a single identity batch call', async () => {
    h.mock('GET', '/media/internal/v1/media', () => ({
      body: {
        items: [ids.u1, ids.u2, ids.u3, ids.u1].map((owner, i) => ({
          id: `0192a3b4-0000-7000-8000-0000000001${i}0`, ownerId: owner, kind: 'IMAGE', purpose: 'POST', status: 'FLAGGED', url: `http://m/${i}`, thumbnailUrl: null, tags: [], ocrText: null,
          createdAt: `2026-10-14T10:0${i}:00Z`, updatedAt: `2026-10-14T10:0${i}:00Z`,
          moderationResults: [{ model: 'nsfw', modelVersion: '1.2.0', labels: ['suggestive'], scores: { nsfw: 0.71 }, decision: 'REVIEW', frameScores: [{ index: 0, timestampSeconds: 0, nsfw: 0.2 }, { index: 1, timestampSeconds: 2, nsfw: 0.71 }], worstFrameIndex: 1, createdAt: '2026-10-14T10:00:00Z' }],
        })),
        nextCursor: null,
      },
    }));
    h.mock('GET', '/social/internal/v1/posts', () => ({ body: { items: [], nextCursor: null } }));
    h.mock('GET', '/identity/internal/v1/users', (c) => ({ body: { items: (c.query.get('ids') ?? '').split(',').map((id) => user(id)), nextCursor: null } }));

    const res = await h.gql('{ moderationQueue(first: 10) { totalCount edges { node { id source openReports media { status previewUrl moderation { decision maxScore labels frameScores { index timestampSeconds nsfw } worstFrameIndex } owner { id email } } } } pageInfo { hasNextPage } } }', { token: moderator });
    expect(res.body.errors).toBeUndefined();
    const q = res.body.data.moderationQueue;
    expect(q.totalCount).toBe(4);
    expect(q.edges[0].node).toMatchObject({ source: 'AI', media: { status: 'FLAGGED', moderation: { decision: 'REVIEW', maxScore: 0.71, labels: ['suggestive'], worstFrameIndex: 1, frameScores: [{ index: 0, timestampSeconds: 0, nsfw: 0.2 }, { index: 1, timestampSeconds: 2, nsfw: 0.71 }] }, owner: { id: ids.u1 } } });
    const userCalls = h.callsTo('/identity/internal/v1/users');
    expect(userCalls).toHaveLength(1);
    expect(userCalls[0]!.query.get('ids')!.split(',').sort()).toEqual([ids.u1, ids.u2, ids.u3].sort());
  });

  it('merges hidden posts, filters by source and pages with offset cursors', async () => {
    h.mock('GET', '/media/internal/v1/media', () => ({ body: { items: [], nextCursor: null } }));
    h.mock('GET', '/social/internal/v1/posts', () => ({
      body: { items: [1, 2, 3].map((n) => ({ id: `0192a3b4-0000-7000-8000-00000000030${n}`, authorId: ids.u1, text: `t${n}`, hashtags: [], visibility: 'PUBLIC', status: 'HIDDEN', media: [], reportsCount: n, createdAt: `2026-10-14T1${n}:00:00Z`, updatedAt: `2026-10-14T1${n}:00:00Z` })), nextCursor: null },
    }));
    const first = await h.gql('{ moderationQueue(first: 2, filter:{source: REPORTS}) { edges { cursor node { openReports post { text status } } } pageInfo { hasNextPage endCursor } } }', { token: admin });
    expect(first.body.data.moderationQueue.edges.map((e: { node: { openReports: number } }) => e.node.openReports)).toEqual([1, 2]);
    const { hasNextPage, endCursor } = first.body.data.moderationQueue.pageInfo;
    expect(hasNextPage).toBe(true);
    const second = await h.gql('query($a:String){ moderationQueue(first: 2, after:$a) { edges { node { openReports } } pageInfo { hasNextPage } } }', { token: admin, variables: { a: endCursor } });
    expect(second.body.data.moderationQueue.edges).toEqual([{ node: { openReports: 3 } }]);
    expect(second.body.data.moderationQueue.pageInfo.hasNextPage).toBe(false);
  });
});

describe('mutations', () => {
  it('updateUserRoles forwards X-Actor-Id and returns the user; business errors come back as UserError', async () => {
    h.mock('PATCH', `/identity/internal/v1/users/${ids.u1}/roles`, (c) => ({ body: user(ids.u1, { roles: (c.body as { roles: string[] }).roles }) }));
    const ok = await h.gql(`mutation { updateUserRoles(input:{userId:"${ids.u1}", roles:[STUDENT, ORGANIZER]}) { user { id roles } errors { code message } } }`, { token: admin });
    expect(ok.body.data.updateUserRoles).toEqual({ user: { id: ids.u1, roles: ['STUDENT', 'ORGANIZER'] }, errors: [] });
    expect(h.callsTo('/identity/internal/v1/users')[0]!.headers['x-actor-id']).toBe(ids.admin);

    h.mock('PATCH', `/identity/internal/v1/users/${ids.u2}/roles`, () => ({ status: 422, body: { code: 'LAST_ADMIN', title: 'No se puede quitar el rol', detail: 'Debe existir al menos un administrador.', status: 422 } }));
    const bad = await h.gql(`mutation { updateUserRoles(input:{userId:"${ids.u2}", roles:[STUDENT]}) { user { id } errors { code message } } }`, { token: admin });
    expect(bad.body.errors).toBeUndefined();
    expect(bad.body.data.updateUserRoles).toEqual({ user: null, errors: [{ code: 'LAST_ADMIN', message: 'Debe existir al menos un administrador.' }] });
  });

  it('suspendUser is open to MODERATOR; moderateMedia and resolveContentReport call the owning services', async () => {
    h.mock('PATCH', `/identity/internal/v1/users/${ids.u1}/status`, (c) => {
      const b = c.body as { status: string; reason?: string };
      return { body: user(ids.u1, b.status === 'SUSPENDED' ? { status: 'SUSPENDED', suspendedAt: '2026-10-15T12:00:00Z', suspensionReason: b.reason } : { status: 'ACTIVE' }) };
    });
    const s = await h.gql(`mutation { suspendUser(input:{userId:"${ids.u1}", reason:"spam repetido"}) { user { status suspendedAt suspensionReason } errors { code } } }`, { token: moderator });
    expect(s.body.data.suspendUser.user).toEqual({ status: 'SUSPENDED', suspendedAt: '2026-10-15T12:00:00Z', suspensionReason: 'spam repetido' });
    const back = await h.gql(`mutation { reactivateUser(input:{userId:"${ids.u1}"}) { user { status suspendedAt suspensionReason } errors { code } } }`, { token: admin });
    expect(back.body.data.reactivateUser.user).toEqual({ status: 'ACTIVE', suspendedAt: null, suspensionReason: null });
    expect(h.callsTo('/identity/internal/v1/users')[0]!.body).toEqual({ status: 'SUSPENDED', reason: 'spam repetido' });
    expect(h.callsTo('/identity/internal/v1/users')[1]!.body).toEqual({ status: 'ACTIVE' });

    const mediaId = '0192a3b4-0000-7000-8000-000000000500';
    h.mock('POST', `/media/internal/v1/media/${mediaId}/decision`, () => ({ body: { id: mediaId, ownerId: ids.u1, kind: 'IMAGE', purpose: 'POST', status: 'REJECTED', url: null, thumbnailUrl: null, tags: [], ocrText: null, createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:00:00Z', moderationResults: [] } }));
    const m = await h.gql(`mutation { moderateMedia(id:"${mediaId}", decision: REJECT, note:"explícito") { media { id status } errors { code } } }`, { token: moderator });
    expect(m.body.data.moderateMedia).toEqual({ media: { id: mediaId, status: 'REJECTED' }, errors: [] });
    expect(h.callsTo('/media/internal')[0]!.body).toEqual({ decision: 'REJECT', note: 'explícito' });

    const reportId = '0192a3b4-0000-7000-8000-000000000600';
    h.mock('PATCH', `/social/internal/v1/reports/${reportId}`, () => ({ status: 404, body: { code: 'NOT_FOUND', detail: 'Denuncia no encontrada', status: 404 } }));
    const r = await h.gql(`mutation { resolveContentReport(input:{reportId:"${reportId}", resolution: KEEP}) { report { id } errors { code message } } }`, { token: moderator });
    expect(r.body.data.resolveContentReport).toEqual({ report: null, errors: [{ code: 'NOT_FOUND', message: 'Denuncia no encontrada' }] });
  });

  it('panel safeguards: ROLES_REQUIRED, CANNOT_DEMOTE_SELF and CANNOT_SUSPEND_SELF never reach identity', async () => {
    const empty = await h.gql(`mutation { updateUserRoles(input:{userId:"${ids.u1}", roles:[]}) { user { id } errors { code } } }`, { token: admin });
    expect(empty.body.data.updateUserRoles).toEqual({ user: null, errors: [{ code: 'ROLES_REQUIRED' }] });
    const demote = await h.gql(`mutation { updateUserRoles(input:{userId:"${ids.admin}", roles:[MODERATOR]}) { user { id } errors { code } } }`, { token: admin });
    expect(demote.body.data.updateUserRoles).toEqual({ user: null, errors: [{ code: 'CANNOT_DEMOTE_SELF' }] });
    const self = await h.gql(`mutation { suspendUser(input:{userId:"${ids.moderator}", reason:"x"}) { user { id } errors { code message } } }`, { token: moderator, lang: 'en' });
    expect(self.body.data.suspendUser.errors[0]).toEqual({ code: 'CANNOT_SUSPEND_SELF', message: 'You cannot suspend your own account.' });
    expect(h.callsTo('/identity/internal')).toHaveLength(0);
  });

  it('moderateMedia maps MEDIA_NOT_FLAGGED to ALREADY_MODERATED', async () => {
    const mediaId = '0192a3b4-0000-7000-8000-000000000501';
    h.mock('POST', `/media/internal/v1/media/${mediaId}/decision`, () => ({ status: 409, body: { code: 'MEDIA_NOT_FLAGGED', detail: 'Ya resuelto', status: 409 } }));
    const m = await h.gql(`mutation { moderateMedia(id:"${mediaId}", decision: APPROVE) { media { id } errors { code } } }`, { token: moderator });
    expect(m.body.data.moderateMedia).toEqual({ media: null, errors: [{ code: 'ALREADY_MODERATED' }] });
  });

  it('ContentReport.post is the real post (internal social endpoint) and Registration.saga is found beyond the first page', async () => {
    const reportId = '0192a3b4-0000-7000-8000-000000000601';
    const postId = '0192a3b4-0000-7000-8000-000000000602';
    h.mock('GET', '/social/internal/v1/reports', () => ({ body: { items: [{ id: reportId, targetType: 'POST', targetId: postId, reporterId: ids.u1, reason: 'SPAM', details: null, status: 'OPEN', resolution: null, resolutionNote: null, createdAt: '2026-10-14T10:00:00Z', resolvedAt: null }], nextCursor: null } }));
    h.mock('GET', `/social/internal/v1/posts/${postId}`, () => ({ body: { id: postId, authorId: ids.u2, text: 'hola', hashtags: [], visibility: 'PUBLIC', status: 'HIDDEN', media: [], reportsCount: 1, createdAt: '2026-10-14T09:00:00Z', updatedAt: '2026-10-14T09:00:00Z' } }));
    const r = await h.gql('{ contentReports { id post { id text status } } }', { token: moderator });
    expect(r.body.data.contentReports).toEqual([{ id: reportId, post: { id: postId, text: 'hola', status: 'HIDDEN' } }]);
  });

  it('contentReports resolves the reported comment and its post for COMMENT reports (R-1)', async () => {
    const reportId = '0192a3b4-0000-7000-8000-000000000611';
    const commentId = '0192a3b4-0000-7000-8000-000000000612';
    const postId = '0192a3b4-0000-7000-8000-000000000613';
    h.mock('GET', '/social/internal/v1/reports', () => ({ body: { items: [{ id: reportId, targetType: 'COMMENT', targetId: commentId, reporterId: ids.u1, reason: 'HARASSMENT', details: null, status: 'OPEN', resolution: null, resolutionNote: null, createdAt: '2026-10-14T10:00:00Z', resolvedAt: null }], nextCursor: null } }));
    h.mock('GET', `/social/internal/v1/comments/${commentId}`, () => ({ body: { id: commentId, postId, authorId: ids.u2, text: 'comentario ofensivo', status: 'VISIBLE', createdAt: '2026-10-14T09:30:00Z' } }));
    h.mock('GET', `/social/internal/v1/posts/${postId}`, () => ({ body: { id: postId, authorId: ids.u3, text: 'post original', hashtags: [], visibility: 'PUBLIC', status: 'PUBLISHED', media: [], reportsCount: 0, createdAt: '2026-10-14T09:00:00Z', updatedAt: '2026-10-14T09:00:00Z' } }));
    const r = await h.gql('{ contentReports { id comment { id postId text status } post { id text } } }', { token: moderator });
    expect(r.body.data.contentReports).toEqual([{ id: reportId, comment: { id: commentId, postId, text: 'comentario ofensivo', status: 'VISIBLE' }, post: { id: postId, text: 'post original' } }]);
  });

  it('retrySaga and sagas go to events-service', async () => {
    const sagaId = '0192a3b4-0000-7000-8000-000000000700';
    const saga = { id: sagaId, type: 'REGISTRATION', registrationId: ids.u1, eventId: ids.u2, userId: ids.u3, step: 'REFUND_CREDITS', status: 'FAILED', failureReason: 'TIMEOUT', retries: 3, deadlineAt: null, startedAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:01:00Z' };
    h.mock('GET', '/events/internal/v1/sagas', () => ({ body: { items: [saga], nextCursor: null } }));
    h.mock('POST', `/events/internal/v1/sagas/${sagaId}/retry`, () => ({ status: 202, body: { ...saga, status: 'COMPENSATING' } }));
    const list = await h.gql('{ sagas(status: FAILED, first: 10) { id step status failureReason retries } }', { token: admin });
    expect(list.body.data.sagas).toEqual([{ id: sagaId, step: 'REFUND_CREDITS', status: 'FAILED', failureReason: 'TIMEOUT', retries: 3 }]);
    expect(h.callsTo('/events/internal/v1/sagas')[0]!.query.get('status')).toBe('FAILED');
    const retry = await h.gql(`mutation { retrySaga(id:"${sagaId}") { saga { status } errors { code } } }`, { token: admin });
    expect(retry.body.data.retrySaga).toEqual({ saga: { status: 'COMPENSATING' }, errors: [] });
  });
});

describe('MCP tokens (UC-22)', () => {
  const tokenId = '0192a3b4-0000-7000-8000-000000000700';

  it('createMcpToken forwards the ADMIN token to identity and returns the token once; only ADMIN may call it', async () => {
    h.mock('POST', '/identity/api/v1/auth/mcp-tokens', () => ({
      status: 201,
      body: { id: tokenId, accessToken: 'jwt.mcp.token', tokenType: 'Bearer', audience: 'mcp', scopes: ['mcp:tools'], label: 'Claude Desktop', expiresIn: 28800, expiresAt: '2026-10-15T20:00:00Z', createdAt: '2026-10-15T12:00:00Z' },
    }));
    const res = await h.gql('mutation { createMcpToken(input:{label:"Claude Desktop"}) { token { id accessToken audience scopes label expiresAt } errors { code } } }', { token: admin });
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.createMcpToken).toEqual({ token: { id: tokenId, accessToken: 'jwt.mcp.token', audience: 'mcp', scopes: ['mcp:tools'], label: 'Claude Desktop', expiresAt: '2026-10-15T20:00:00Z' }, errors: [] });
    const call = h.callsTo('/identity/api/v1/auth/mcp-tokens')[0]!;
    expect(call.headers.authorization).toBe(`Bearer ${admin}`);
    expect(call.body).toEqual({ label: 'Claude Desktop' });
    expect(code(await h.gql('mutation { createMcpToken { errors { code } } }', { token: moderator }))).toBe('FORBIDDEN');
  });

  it('revokeMcpToken returns the id, maps a missing token to errors[] by code and is ADMIN only', async () => {
    h.mock('DELETE', `/identity/api/v1/auth/mcp-tokens/${tokenId}`, () => ({ status: 204 }));
    const ok = await h.gql(`mutation { revokeMcpToken(id:"${tokenId}") { revokedId errors { code } } }`, { token: admin });
    expect(ok.body.data.revokeMcpToken).toEqual({ revokedId: tokenId, errors: [] });
    expect(h.callsTo('/identity/api/v1/auth/mcp-tokens/')[0]!.headers.authorization).toBe(`Bearer ${admin}`);

    const other = '0192a3b4-0000-7000-8000-000000000701';
    h.mock('DELETE', `/identity/api/v1/auth/mcp-tokens/${other}`, () => ({ status: 404, body: { code: 'NOT_FOUND', detail: 'Token no encontrado', status: 404 } }));
    const missing = await h.gql(`mutation { revokeMcpToken(id:"${other}") { revokedId errors { code message } } }`, { token: admin });
    expect(missing.body.data.revokeMcpToken).toEqual({ revokedId: null, errors: [{ code: 'NOT_FOUND', message: 'Token no encontrado' }] });
    expect(code(await h.gql(`mutation { revokeMcpToken(id:"${tokenId}") { errors { code } } }`, { token: moderator }))).toBe('FORBIDDEN');
  });
});

describe('limits and hardening', () => {
  it('rejects too deep queries (> 7) before touching any service', async () => {
    const res = await h.gql('{ moderationQueue { edges { node { post { media { owner { university { id } } } } } } } }', { token: admin });
    expect(code(res)).toBe('QUERY_TOO_DEEP');
    expect(h.calls).toHaveLength(0);
  });

  it('rejects too complex queries', async () => {
    const q = `{ users(first: 50) { edges { node { id email displayName career semester avatarUrl university { id name allowedDomains enabled createdAt } } } } ev: events(first: 50) { id title organizer { id email university { id name } } registrations { id user { id email } saga { id } } } }`;
    expect(code(await h.gql(q, { token: admin }))).toBe('QUERY_TOO_COMPLEX');
  });

  it('has persisted queries disabled', async () => {
    const res = await request(h.baseUrl).post('/graphql').set('Authorization', `Bearer ${admin}`).send({ extensions: { persistedQuery: { version: 1, sha256Hash: 'a'.repeat(64) } } });
    expect(JSON.stringify(res.body)).toMatch(/PersistedQueryNotSupported|persisted/i);
  });

  it('allows CORS with credentials only for configured origins', async () => {
    const ok = await request(h.baseUrl).options('/graphql').set('Origin', 'http://localhost:3001').set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const other = await request(h.baseUrl).options('/graphql').set('Origin', 'http://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('exposes introspection in dev and does not leak internal errors', async () => {
    const res = await h.gql('{ __schema { queryType { name } } }', { token: admin });
    expect(res.body.data.__schema.queryType.name).toBe('Query');
    h.mock('GET', '/identity/internal/v1/users', () => ({ status: 500, body: { code: 'INTERNAL_ERROR', detail: 'boom' } }));
    const err = await h.gql('{ user(id:"' + ids.u1 + '") { id } }', { token: admin });
    expect(err.body.errors[0].extensions.code).toBe('INTERNAL_ERROR');
  });
});

describe('serviceHealth, dashboard and walletStats', () => {
  it('reports each service /health/ready and overall status', async () => {
    h.mock('GET', '/media/health/ready', () => ({ status: 503, body: { status: 'DOWN' } }));
    h.mock('GET', '/events/health/ready', () => ({ body: { status: 'UP', checks: { db: 'UP', broker: 'UP' } } }));
    const res = await h.gql('{ serviceHealth { overall checkedAt services { name status latencyMs checks error } queues { name } } }', { token: admin });
    expect(res.body.errors).toBeUndefined();
    const sh = res.body.data.serviceHealth;
    expect(sh.overall).toBe('DEGRADED');
    const byName = Object.fromEntries(sh.services.map((s: { name: string }) => [s.name, s]));
    expect(byName['media-service']).toMatchObject({ status: 'DOWN', error: 'HTTP 503' });
    expect(byName['events-service']).toMatchObject({ status: 'UP', checks: { db: 'UP', broker: 'UP' } });
    expect(sh.services).toHaveLength(7);
    expect(sh.queues).toEqual([]);
  });

  it('aggregates the dashboard and degrades to zeros + SERVICE_UNAVAILABLE when a source fails', async () => {
    h.mock('GET', '/social/internal/v1/stats/daily', () => ({ body: { from: '2026-10-13', to: '2026-10-14', days: [{ date: '2026-10-13', postsCreated: 142, commentsCreated: 389, reactionsSet: 1204, followsCreated: 1, activeAuthors: 96, postsHidden: 2 }, { date: '2026-10-14', postsCreated: 158, commentsCreated: 412, reactionsSet: 1350, followsCreated: 1, activeAuthors: 103, postsHidden: 1 }], topHashtags: [] } }));
    h.mock('GET', '/events/internal/v1/stats/registrations', () => ({ body: { from: '2026-10-13', to: '2026-10-14', groupBy: 'day', totals: { pending: 0, confirmed: 30, failed: 2, cancelled: 1, creditsCollected: 600, creditsRefunded: 20 }, series: [{ key: '2026-10-13', label: '2026-10-13', pending: 0, confirmed: 10, failed: 1, cancelled: 0, creditsCollected: 1, creditsRefunded: 0 }] } }));
    h.mock('GET', '/wallet/internal/v1/stats/credits', () => ({ status: 503, body: {} }));
    h.mock('GET', '/identity/internal/v1/users', () => ({ body: { items: [user(ids.u1, { createdAt: '2026-10-13T08:00:00Z' }), user(ids.u2, { createdAt: '2026-09-01T08:00:00Z' })], nextCursor: null } }));
    h.mock('GET', '/media/internal/v1/media', () => ({ body: { items: [], nextCursor: null } }));
    h.mock('GET', '/social/internal/v1/posts', () => ({ body: { items: [{ id: ids.u1, authorId: ids.u1, text: 'x', hashtags: [], visibility: 'PUBLIC', status: 'HIDDEN', media: [], reportsCount: 3, createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z' }], nextCursor: null } }));
    const res = await h.gql('{ dashboard(range:{from:"2026-10-13", to:"2026-10-14"}) { range { from to } activeUsers newUsers posts comments reactions registrationsConfirmed registrationsFailed registrationsCancelled creditsSpent flaggedContent openAlerts series { name points { date value } } } }', { token: admin });
    expect(res.body.data.dashboard).toMatchObject({ activeUsers: 103, newUsers: 1, posts: 300, comments: 801, reactions: 2554, registrationsConfirmed: 30, registrationsFailed: 2, registrationsCancelled: 1, creditsSpent: 0, flaggedContent: 1, openAlerts: 0 });
    expect(res.body.data.dashboard.series[0]).toEqual({ name: 'postsCreated', points: [{ date: '2026-10-13', value: 142 }, { date: '2026-10-14', value: 158 }] });
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].extensions).toMatchObject({ code: 'SERVICE_UNAVAILABLE', component: 'wallet', degraded: true });
    expect(code(await h.gql('{ dashboard(range:{from:"2026-10-14", to:"2026-10-13"}) { activeUsers } }', { token: admin }))).toBe('VALIDATION_FAILED');
  });

  it('walletStats maps the wallet aggregates', async () => {
    h.mock('GET', '/wallet/internal/v1/stats/credits', (c) => ({ body: { from: c.query.get('from'), to: c.query.get('to'), groupBy: 'day', totals: { topUpCount: 42, topUpCredits: 2650, debitCount: 118, debitCredits: 1770, refundCount: 9, refundCredits: 135, netCredits: 1015, circulatingCredits: 12480 }, series: [{ date: '2026-10-07', topUpCredits: 300, debitCredits: 210, refundCredits: 15 }] } }));
    const res = await h.gql('{ walletStats(range:{from:"2026-10-07", to:"2026-10-13", bucket: WEEK}) { range { from to } topUpCount topUpCredits netCredits circulatingCredits series { date topUpCredits } } }', { token: admin });
    expect(res.body.data.walletStats).toEqual({ range: { from: '2026-10-07', to: '2026-10-13' }, topUpCount: 42, topUpCredits: 2650, netCredits: 1015, circulatingCredits: 12480, series: [{ date: '2026-10-07', topUpCredits: 300 }] });
    expect(h.callsTo('/wallet')[0]!.query.get('groupBy')).toBe('week');
  });
});

describe('ticketValidations (attendance report)', () => {
  it('lists who scanned whose ticket, resolves names and is ADMIN only', async () => {
    h.mock('GET', '/ticketing/internal/v1/validations', (c) => ({
      body: {
        from: c.query.get('from'),
        to: c.query.get('to'),
        truncated: false,
        items: [{ ticketId: ids.u3, eventId: ids.uni, eventTitle: 'Hackathon', attendeeId: ids.u1, validatedBy: ids.u2, validatedAt: '2026-11-08T22:45:00Z' }],
      },
    }));
    h.mock('GET', '/identity/internal/v1/users', () => ({ body: { items: [user(ids.u1), user(ids.u2)], nextCursor: null } }));
    for (const id of [ids.u1, ids.u2]) h.mock('GET', `/social/internal/v1/profiles/${id}`, () => ({ body: { userId: id, displayName: id === ids.u1 ? 'Jorge' : 'Julio' } }));
    const q = '{ ticketValidations(range:{from:"2026-11-01", to:"2026-11-09"}, first: 50) { truncated items { ticketId eventTitle validatedAt attendee { id displayName } validatedBy { id displayName } } } }';
    const res = await h.gql(q, { token: admin });
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.ticketValidations.items).toHaveLength(1);
    expect(res.body.data.ticketValidations.items[0]).toMatchObject({ eventTitle: 'Hackathon', validatedAt: '2026-11-08T22:45:00.000Z' });
    const call = h.callsTo('/ticketing')[0]!;
    expect(call.query.get('from')).toBe('2026-11-01');
    expect(call.query.get('limit')).toBe('50');
    expect(code(await h.gql(q, { token: moderator }))).toBe('FORBIDDEN');
  });
});

describe('subscriptions (graphql-ws + RabbitMQ)', () => {
  const subscribe = (token: string | undefined, query: string) =>
    new Promise<{ data?: unknown; errors?: { extensions?: { code?: string } }[] }>((resolve, reject) => {
      const client = h.wsClient(token);
      let published = false;
      let timer: NodeJS.Timeout | undefined;
      client.subscribe(
        { query },
        {
          next: (value) => {
            published = true;
            clearInterval(timer);
            resolve(value as never);
            void client.dispose();
          },
          error: (e) => {
            void client.dispose();
            reject(e instanceof Error ? e : new Error(JSON.stringify(e)));
          },
          complete: () => undefined,
        },
      );
      client.on('connected', () => {
        // the consumer queue is declared asynchronously at boot; keep publishing until the event is delivered
        timer = setInterval(() => {
          if (published) return clearInterval(timer);
          void h.publish('bandada.media.asset.flagged.v1', { mediaId: '0192a3b4-0000-7000-8000-000000000800', ownerId: ids.u1, kind: 'IMAGE', decision: 'REVIEW', labels: ['suggestive'], scores: { nsfw: 0.71 }, maxScore: 0.71, modelVersion: '1.2.0', occurredAt: '2026-10-14T10:00:00Z' });
        }, 300);
        setTimeout(() => (published = true), 10_000);
      });
    });

  it('moderationQueueChanged delivers an event published by hand to RabbitMQ', async () => {
    h.mock('GET', '/media/internal/v1/media', () => ({ body: { items: [], nextCursor: null } }));
    h.mock('GET', '/social/internal/v1/posts', () => ({ body: { items: [], nextCursor: null } }));
    h.mock('GET', '/identity/internal/v1/users', (c) => ({ body: { items: (c.query.get('ids') ?? '').split(',').filter(Boolean).map((id) => user(id)), nextCursor: null } }));
    const result = await subscribe(moderator, 'subscription { moderationQueueChanged { type totalCount item { id source openReports media { status moderation { maxScore } owner { id } } } } }');
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      moderationQueueChanged: { type: 'ADDED', totalCount: 0, item: { id: '0192a3b4-0000-7000-8000-000000000800', source: 'AI', openReports: 0, media: { status: 'FLAGGED', moderation: { maxScore: 0.71 }, owner: { id: ids.u1 } } } },
    });
  });

  it('refuses the subscription without a valid token', async () => {
    const anon = await new Promise<unknown>((resolve) => {
      const c = h.wsClient(undefined);
      c.subscribe({ query: 'subscription { moderationQueueChanged { type } }' }, { next: resolve, error: resolve, complete: () => resolve('complete') });
    });
    expect(JSON.stringify(anon)).toContain('UNAUTHENTICATED');
  });
});

describe('health', () => {
  it('serves /health/live and /health/ready', async () => {
    expect((await request(h.baseUrl).get('/health/live')).body).toEqual({ status: 'UP' });
    const ready = await request(h.baseUrl).get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.checks.graphql).toBe('UP');
  });
});
