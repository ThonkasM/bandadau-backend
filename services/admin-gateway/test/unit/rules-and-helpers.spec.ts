import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildASTSchema, parse, specifiedRules, validate } from 'graphql';

import { ServiceHttpError, toUserErrors } from '../../src/common/errors';
import { ServiceHttp } from '../../src/common/http-client';
import { clampFirst, connectionFromPage, decodeOffset, encodeOffset } from '../../src/common/relay';
import { loadConfig } from '../../src/config/env';
import { buildSchema, loadSdl } from '../../src/graphql/schema';
import { complexityLimitRule, depthLimitRule } from '../../src/graphql/validation-rules';
import { changeFromEvent } from '../../src/modules/moderation/moderation.subscriptions';

const schema = buildSchema({});

describe('contract SDL copy', () => {
  it('builds a schema with the contract root fields', () => {
    expect(Object.keys(schema.getQueryType()!.getFields())).toEqual(expect.arrayContaining(['me', 'dashboard', 'moderationQueue', 'serviceHealth']));
    expect(Object.keys(schema.getSubscriptionType()!.getFields())).toEqual(['alertRaised', 'moderationQueueChanged', 'reportReady']);
    expect(buildASTSchema(parse(loadSdl())).getType('Dashboard')).toBeDefined();
  });

  const contract = join(__dirname, '../../../../../bandadau-docs/contracts/graphql/admin.graphql');
  (existsSync(contract) ? it : it.skip)('schema/admin.graphql is identical to bandadau-docs/contracts/graphql/admin.graphql', () => {
    expect(loadSdl()).toBe(readFileSync(contract, 'utf8'));
  });
});

describe('depth and complexity rules', () => {
  const run = (query: string, depth = 7, complexity = 1000) =>
    validate(schema, parse(query), [...specifiedRules, depthLimitRule(depth), complexityLimitRule(complexity)]);

  it('accepts depth 7 and rejects depth 8 (QUERY_TOO_DEEP)', () => {
    // moderationQueue > edges > node > post > author > university > ... counts fields
    const ok = '{ moderationQueue { edges { node { post { author { university { id } } } } } } }'; // depth 7
    const deep = '{ moderationQueue { edges { node { post { media { owner { university { id } } } } } } } }'; // depth 8
    expect(run(ok)).toEqual([]);
    const errors = run(deep);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.extensions).toMatchObject({ code: 'QUERY_TOO_DEEP', maxDepth: 7, depth: 8 });
  });

  it('counts fragments and ignores __typename', () => {
    const q = `query { moderationQueue { ...A } } fragment A on ModerationItemConnection { edges { node { post { media { owner { university { id } } } } } } }`;
    expect(run(q)[0]?.extensions?.code).toBe('QUERY_TOO_DEEP');
    expect(run('{ __typename me { __typename id } }')).toEqual([]);
  });

  it('rejects a query whose cost exceeds the limit (QUERY_TOO_COMPLEX), multiplying by first', () => {
    const q = '{ users(first: 100) { edges { node { id email university { id name } displayName } } } }';
    expect(run(q, 7, 1000)).toEqual([]);
    const errors = run(q, 7, 100);
    expect(errors[0]?.extensions).toMatchObject({ code: 'QUERY_TOO_COMPLEX', maxComplexity: 100 });
  });
});

describe('relay helpers', () => {
  it('wraps a service page and keeps the service cursor as endCursor', () => {
    const c = connectionFromPage(['a', 'b'], 'next', 'prev');
    expect(c.edges).toHaveLength(2);
    expect(c.pageInfo).toMatchObject({ hasNextPage: true, hasPreviousPage: true, endCursor: 'next' });
    expect(connectionFromPage([], null).pageInfo.hasNextPage).toBe(false);
  });

  it('round-trips offset cursors and clamps first', () => {
    expect(decodeOffset(encodeOffset(40))).toBe(40);
    expect(decodeOffset('garbage')).toBe(0);
    expect(clampFirst(500)).toBe(50);
    expect(clampFirst(0)).toBe(1);
    expect(clampFirst(undefined)).toBe(20);
  });
});

describe('errors and http client', () => {
  it('turns 4xx business problems into UserErrors and rethrows the rest', () => {
    const business = new ServiceHttpError('identity-service', 422, { code: 'LAST_ADMIN', detail: 'x', errors: [{ field: '/roles' }] });
    expect(toUserErrors(business)).toEqual([{ code: 'LAST_ADMIN', message: 'x', field: ['roles'] }]);
    expect(() => toUserErrors(new ServiceHttpError('identity-service', 503, undefined))).toThrow();
    expect(() => toUserErrors(new ServiceHttpError('identity-service', 403, { code: 'FORBIDDEN' }))).toThrow();
  });

  it('sends service token, actor, language and maps problems / transport errors; retries GET once', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    let n = 0;
    const fakeFetch = (async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), headers: init.headers as Record<string, string> });
      n += 1;
      if (n === 1) throw new Error('ECONNRESET');
      if (String(url).includes('/boom')) return new Response(JSON.stringify({ code: 'SAGA_NOT_RETRYABLE', detail: 'no' }), { status: 409 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const http = new ServiceHttp({ name: 'events-service', baseUrl: 'http://e', timeoutMs: 500, fetch: fakeFetch, tokens: { authHeaders: async (x) => ({ Authorization: 'Bearer svc', ...(x?.actorId ? { 'X-Actor-Id': x.actorId } : {}) }), invalidate: () => undefined } });
    await expect(http.request('GET', '/x', { actorId: 'u1', locale: 'en', query: { a: 1, b: undefined, n: null, e: '', c: ['x', 'y'] } })).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe('http://e/x?a=1&c=x%2Cy');
    expect(calls[1]?.headers).toMatchObject({ Authorization: 'Bearer svc', 'X-Actor-Id': 'u1', 'Accept-Language': 'en' });
    await expect(http.request('POST', '/boom')).rejects.toMatchObject({ status: 409, code: 'SAGA_NOT_RETRYABLE' });
  });
});

describe('moderation events', () => {
  it('maps media and social events to queue changes', () => {
    const flagged = changeFromEvent({ id: '1', type: 'bandada.media.asset.flagged.v1', data: { mediaId: 'm', ownerId: 'o', kind: 'IMAGE', decision: 'REVIEW', labels: ['x'], scores: { nsfw: 0.7 }, maxScore: 0.7, modelVersion: '1', occurredAt: '2026-10-14T10:00:00Z' } });
    expect(flagged).toMatchObject({ type: 'ADDED', item: { id: 'm', source: 'AI', media: { status: 'FLAGGED', moderation: { maxScore: 0.7 } } } });
    expect(changeFromEvent({ id: '2', type: 'bandada.media.asset.approved.v1', data: { mediaId: 'm', ownerId: 'o', kind: 'IMAGE' } })?.type).toBe('RESOLVED');
    expect(changeFromEvent({ id: '3', type: 'bandada.social.post.hidden.v1', data: { postId: 'p', authorId: 'a' } })).toMatchObject({ type: 'ADDED', item: { source: 'REPORTS', post: { status: 'HIDDEN' } } });
    expect(changeFromEvent({ id: '4', type: 'bandada.other.v1', data: {} })).toBeNull();
  });
});

describe('config', () => {
  const base = { JWKS_URL: 'j', JWT_ISSUER: 'i', IDENTITY_URL: 'http://i/', SOCIAL_SERVICE_URL: 's', MEDIA_SERVICE_URL: 'm', EVENTS_SERVICE_URL: 'e', WALLET_SERVICE_URL: 'w', TICKETING_SERVICE_URL: 't', SERVICE_CLIENT_SECRET: 'x', RABBITMQ_URL: 'amqp://x' };
  it('applies defaults, disables introspection and landing page in production', () => {
    expect(loadConfig(base)).toMatchObject({ port: 7010, maxDepth: 7, maxComplexity: 1000, introspection: true, landingPage: true });
    expect(loadConfig({ ...base, NODE_ENV: 'production' })).toMatchObject({ introspection: false, landingPage: false });
    expect(loadConfig(base).services.identity).toBe('http://i');
    expect(() => loadConfig({})).toThrow();
  });
});
