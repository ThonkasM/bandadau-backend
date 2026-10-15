import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { uuidv7 } from '@bandada/messaging-ts';
import { CompactSign, importJWK } from 'jose';
import request from 'supertest';

import { type Harness, ISSUE, issueCommand, startHarness, VOID } from './support/harness';

const ORGANIZER = uuidv7();
const OTHER_ORGANIZER = uuidv7();

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h?.close();
});

async function issueOne(overrides: Record<string, unknown> = {}) {
  const cmd = issueCommand({ organizerId: ORGANIZER, ...overrides });
  await h.sendCommand(ISSUE, cmd);
  const issued = await h.waitFor((e) => e.type === 'bandada.ticketing.ticket-issued.v1' && (e.data as { registrationId: string }).registrationId === cmd.registrationId);
  const data = issued.data as { ticketId: string; userId: string };
  return { cmd, ticketId: data.ticketId, userId: data.userId, issued };
}

async function qrOf(ticketId: string, userId: string): Promise<string> {
  const res = await request(h.http).get(`/api/v1/tickets/${ticketId}`).set('Authorization', `Bearer ${await h.token(userId, ['STUDENT'])}`);
  expect(res.status).toBe(200);
  return res.body.qrPayload as string;
}

async function validate(qrPayload: string, opts: { sub?: string; roles?: string[]; key?: string; eventId?: string; lang?: string } = {}) {
  return request(h.http)
    .post('/api/v1/tickets/validate')
    .set('Authorization', `Bearer ${await h.token(opts.sub ?? ORGANIZER, opts.roles ?? ['ORGANIZER'])}`)
    .set('Idempotency-Key', opts.key ?? uuidv7())
    .set('Accept-Language', opts.lang ?? 'es')
    .send({ qrPayload, ...(opts.eventId ? { eventId: opts.eventId } : {}) });
}

const countOf = (type: string, field: string, value: string) =>
  h.eventsOfType(type).filter((e) => (e.data as Record<string, unknown>)[field] === value).length;

describe('issue-ticket command (UC-12, saga step 3)', () => {
  it('issues the ticket, answers ticket-issued through the outbox and stores sentinel, GSI1 and GSI2 entries', async () => {
    const { cmd, ticketId, issued } = await issueOne();
    expect(issued.sagaid).toBe(cmd.sagaId);
    expect(issued.source).toBe('/services/ticketing-service');
    expect(issued.data).toMatchObject({ sagaId: cmd.sagaId, registrationId: cmd.registrationId, eventId: cmd.eventId, userId: cmd.userId });

    const item = await h.ticketItem(ticketId);
    expect(item).toMatchObject({ status: 'ISSUED', organizerId: ORGANIZER, gsi1pk: `USER#${String(cmd.userId)}`, gsi2pk: `REG#${String(cmd.registrationId)}` });

    const gsi2 = await h.doc.send(
      new QueryCommand({ TableName: h.table, IndexName: 'GSI2', KeyConditionExpression: 'gsi2pk = :p', ExpressionAttributeValues: { ':p': `REG#${String(cmd.registrationId)}` } }),
    );
    expect(gsi2.Items?.map((i) => i.ticketId)).toEqual([ticketId]);

    // the outbox row is deleted once published
    for (let i = 0; i < 50 && (await h.pendingOutbox()) > 0; i++) await new Promise((r) => setTimeout(r, 100));
    expect(await h.pendingOutbox()).toBe(0);
  });

  it('is idempotent on redelivery of the same message (inbox) and on a new message for the same registration (sentinel)', async () => {
    const cmd = issueCommand();
    const first = await h.sendCommand(ISSUE, cmd);
    await h.waitFor((e) => e.type === 'bandada.ticketing.ticket-issued.v1' && (e.data as { registrationId: string }).registrationId === cmd.registrationId);

    // same CloudEvent id twice more: inbox swallows them
    await h.sendCommand(ISSUE, cmd, { id: first.id });
    await h.sendCommand(ISSUE, cmd, { id: first.id });
    await new Promise((r) => setTimeout(r, 1500));
    expect(countOf('bandada.ticketing.ticket-issued.v1', 'registrationId', cmd.registrationId as string)).toBe(1);

    // a new message (saga retry) for the same registration answers again with the SAME ticket
    await h.sendCommand(ISSUE, cmd);
    await h.waitFor(() => countOf('bandada.ticketing.ticket-issued.v1', 'registrationId', cmd.registrationId as string) === 2);
    const issued = h.eventsOfType('bandada.ticketing.ticket-issued.v1').filter((e) => (e.data as { registrationId: string }).registrationId === cmd.registrationId);
    expect(new Set(issued.map((e) => (e.data as { ticketId: string }).ticketId)).size).toBe(1);

    const tickets = await h.doc.send(
      new QueryCommand({ TableName: h.table, IndexName: 'GSI1', KeyConditionExpression: 'gsi1pk = :p', ExpressionAttributeValues: { ':p': `USER#${String(cmd.userId)}` } }),
    );
    expect(tickets.Items).toHaveLength(1);
  });

  it('concurrent commands for the same registration yield one ticket', async () => {
    const cmd = issueCommand();
    await Promise.all([h.sendCommand(ISSUE, cmd), h.sendCommand(ISSUE, cmd), h.sendCommand(ISSUE, cmd)]);
    await h.waitFor(() => countOf('bandada.ticketing.ticket-issued.v1', 'registrationId', cmd.registrationId as string) >= 3, 30_000);
    const ticketIds = h.eventsOfType('bandada.ticketing.ticket-issued.v1').filter((e) => (e.data as { registrationId: string }).registrationId === cmd.registrationId).map((e) => (e.data as { ticketId: string }).ticketId);
    expect(new Set(ticketIds).size).toBe(1);
  });
});

describe('void-ticket command (UC-13)', () => {
  it('voids an issued ticket and rejects its validation afterwards (TICKET_VOIDED)', async () => {
    const { cmd, ticketId, userId } = await issueOne();
    const qr = await qrOf(ticketId, userId);
    await h.sendCommand(VOID, { sagaId: cmd.sagaId, registrationId: cmd.registrationId, idempotencyKey: `${String(cmd.sagaId)}:VOID_TICKET`, ticketId, reason: 'USER_CANCELLATION', deadlineAt: new Date().toISOString() });
    const voided = await h.waitFor((e) => e.type === 'bandada.ticketing.ticket-voided.v1' && (e.data as { registrationId: string }).registrationId === cmd.registrationId);
    expect(voided.data).toMatchObject({ ticketId });
    expect(await h.ticketItem(ticketId)).toMatchObject({ status: 'VOIDED' });

    const res = await validate(qr);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TICKET_VOIDED');
  });

  it('a void arriving before the issue blocks the late issue (ALREADY_VOIDED) and answers ticket-voided with a null ticket', async () => {
    const registrationId = uuidv7();
    const sagaId = uuidv7();
    await h.sendCommand(VOID, { sagaId, registrationId, idempotencyKey: `${sagaId}:VOID_TICKET`, ticketId: null, reason: 'SAGA_COMPENSATION', deadlineAt: new Date().toISOString() });
    const voided = await h.waitFor((e) => e.type === 'bandada.ticketing.ticket-voided.v1' && (e.data as { registrationId: string }).registrationId === registrationId);
    expect((voided.data as { ticketId: unknown }).ticketId).toBeNull();

    const cmd = issueCommand({ registrationId, sagaId });
    await h.sendCommand(ISSUE, cmd);
    const failed = await h.waitFor((e) => e.type === 'bandada.ticketing.ticket-issue-failed.v1' && (e.data as { registrationId: string }).registrationId === registrationId);
    expect(failed.data).toMatchObject({ reason: 'ALREADY_VOIDED', sagaId });
    expect(countOf('bandada.ticketing.ticket-issued.v1', 'registrationId', registrationId)).toBe(0);
    const q = await h.doc.send(new QueryCommand({ TableName: h.table, IndexName: 'GSI1', KeyConditionExpression: 'gsi1pk = :p', ExpressionAttributeValues: { ':p': `USER#${String(cmd.userId)}` } }));
    expect(q.Count).toBe(0);
  });

  it('answers ticket-void-failed TICKET_ALREADY_USED when the ticket was already used', async () => {
    const { cmd, ticketId, userId } = await issueOne();
    const ok = await validate(await qrOf(ticketId, userId));
    expect(ok.status).toBe(200);
    await h.sendCommand(VOID, { sagaId: cmd.sagaId, registrationId: cmd.registrationId, idempotencyKey: `${String(cmd.sagaId)}:VOID_TICKET`, ticketId, reason: 'USER_CANCELLATION', deadlineAt: new Date().toISOString() });
    const failed = await h.waitFor((e) => e.type === 'bandada.ticketing.ticket-void-failed.v1' && (e.data as { registrationId: string }).registrationId === cmd.registrationId);
    expect(failed.data).toMatchObject({ ticketId, reason: 'TICKET_ALREADY_USED', usedAt: ok.body.ticket.usedAt });
    expect(await h.ticketItem(ticketId)).toMatchObject({ status: 'USED' });
  });
});

describe('GET /tickets/me, /tickets/:id, /tickets/signing-keys', () => {
  it('lists my tickets ordered by event date with cursor pagination and status filter', async () => {
    const user = uuidv7();
    const dates = [3, 1, 2].map((d) => new Date(Date.now() + d * 86_400_000).toISOString());
    for (const startsAt of dates) await issueOne({ userId: user, eventStartsAt: startsAt });
    const auth = `Bearer ${await h.token(user, ['STUDENT'])}`;

    const page1 = await request(h.http).get('/api/v1/tickets/me?limit=2').set('Authorization', auth);
    expect(page1.status).toBe(200);
    expect(page1.body.items.map((t: { eventStartsAt: string }) => t.eventStartsAt)).toEqual([dates[1], dates[2]]);
    expect(page1.body.nextCursor).toEqual(expect.any(String));
    const page2 = await request(h.http).get(`/api/v1/tickets/me?limit=2&cursor=${page1.body.nextCursor as string}`).set('Authorization', auth);
    expect(page2.body.items.map((t: { eventStartsAt: string }) => t.eventStartsAt)).toEqual([dates[0]]);
    expect(page2.body.nextCursor).toBeNull();

    const none = await request(h.http).get('/api/v1/tickets/me?status=USED').set('Authorization', auth);
    expect(none.body).toEqual({ items: [], nextCursor: null });
    expect((await request(h.http).get('/api/v1/tickets/me?limit=0').set('Authorization', auth)).status).toBe(422);
    const bad = await request(h.http).get('/api/v1/tickets/me?cursor=garbage').set('Authorization', auth);
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_CURSOR');
    expect((await request(h.http).get('/api/v1/tickets/me')).status).toBe(401);
  });

  it('returns the ticket with a QR only to its owner or an ADMIN', async () => {
    const { ticketId, userId } = await issueOne();
    const own = await request(h.http).get(`/api/v1/tickets/${ticketId}`).set('Authorization', `Bearer ${await h.token(userId, ['STUDENT'])}`);
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ id: ticketId, status: 'ISSUED', usedAt: null, voidedAt: null });
    expect(own.body.qrPayload).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const other = await request(h.http).get(`/api/v1/tickets/${ticketId}`).set('Authorization', `Bearer ${await h.token(uuidv7(), ['STUDENT'])}`).set('Accept-Language', 'en');
    expect(other.status).toBe(403);
    expect(other.headers['content-type']).toContain('application/problem+json');
    expect(other.headers['content-language']).toBe('en');
    expect((await request(h.http).get(`/api/v1/tickets/${ticketId}`).set('Authorization', `Bearer ${await h.token(uuidv7(), ['ADMIN'])}`)).status).toBe(200);
    expect((await request(h.http).get(`/api/v1/tickets/${uuidv7()}`).set('Authorization', `Bearer ${await h.token(userId, [])}`)).body.code).toBe('TICKET_NOT_FOUND');
  });

  it('publishes the signing keys as JWKS and the QR verifies with them; altering it breaks the signature', async () => {
    const { ticketId, userId } = await issueOne();
    const qr = await qrOf(ticketId, userId);
    const res = await request(h.http).get('/api/v1/tickets/signing-keys').set('Authorization', `Bearer ${await h.token(userId, [])}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('max-age');
    const [jwk] = res.body.keys as { kid: string }[];
    expect(jwk).toMatchObject({ kty: 'EC', crv: 'P-256', kid: 'tk-it', use: 'sig', alg: 'ES256' });

    const { compactVerify } = await import('jose');
    const key = await importJWK(jwk as never, 'ES256');
    const { payload, protectedHeader } = await compactVerify(qr, key);
    expect(protectedHeader).toEqual({ alg: 'ES256', kid: 'tk-it' });
    expect(JSON.parse(new TextDecoder().decode(payload))).toMatchObject({ tid: ticketId, sub: userId });

    const [header, body, sig] = qr.split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), sub: uuidv7() })).toString('base64url');
    await expect(compactVerify(`${header}.${forged}.${sig}`, key)).rejects.toBeDefined();
    const rejected = await validate(`${header}.${forged}.${sig}`);
    expect(rejected.status).toBe(422);
    expect(rejected.body.code).toBe('INVALID_QR_SIGNATURE');
  });
});

describe('POST /tickets/validate (UC-14)', () => {
  it('validates once: 200 USED, then 409 TICKET_ALREADY_USED with usedAt; ticket.used is published once', async () => {
    const { cmd, ticketId, userId } = await issueOne();
    const qr = await qrOf(ticketId, userId);
    const ok = await validate(qr, { eventId: cmd.eventId as string });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ result: 'VALID', ticket: { id: ticketId, status: 'USED' } });
    expect(ok.body.ticket.usedAt).toEqual(expect.any(String));
    expect(await h.ticketItem(ticketId)).toMatchObject({ status: 'USED', usedBy: ORGANIZER });

    const again = await validate(qr, { lang: 'en' });
    expect(again.status).toBe(409);
    expect(again.headers['content-type']).toContain('application/problem+json');
    expect(again.body).toMatchObject({ code: 'TICKET_ALREADY_USED', ticketId, usedAt: ok.body.ticket.usedAt, title: 'Ticket already used' });

    await h.waitFor((e) => e.type === 'bandada.ticketing.ticket.used.v1' && (e.data as { ticketId: string }).ticketId === ticketId);
    await new Promise((r) => setTimeout(r, 500));
    expect(countOf('bandada.ticketing.ticket.used.v1', 'ticketId', ticketId)).toBe(1);
    expect(h.eventsOfType('bandada.ticketing.ticket.used.v1').find((e) => (e.data as { ticketId: string }).ticketId === ticketId)?.data).toMatchObject({ validatedBy: ORGANIZER, eventId: cmd.eventId, userId });
  });

  it('replays the original answer with the same Idempotency-Key (Idempotent-Replayed) without a second event', async () => {
    const { ticketId, userId } = await issueOne();
    const qr = await qrOf(ticketId, userId);
    const key = uuidv7();
    const first = await validate(qr, { key });
    const replay = await validate(qr, { key });
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    await new Promise((r) => setTimeout(r, 700));
    expect(countOf('bandada.ticketing.ticket.used.v1', 'ticketId', ticketId)).toBe(1);
    expect((await validate(qr, { key: undefined, sub: ORGANIZER })).status).toBe(409);
    // missing key
    const noKey = await request(h.http).post('/api/v1/tickets/validate').set('Authorization', `Bearer ${await h.token(ORGANIZER, ['ORGANIZER'])}`).send({ qrPayload: qr });
    expect(noKey.status).toBe(400);
  });

  it('race: concurrent validations of the same QR with different keys, exactly one wins', async () => {
    for (let round = 0; round < 4; round++) {
      const { ticketId, userId } = await issueOne();
      const qr = await qrOf(ticketId, userId);
      const results = await Promise.all(Array.from({ length: 5 }, () => validate(qr)));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(4);
      expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'TICKET_ALREADY_USED')).toBe(true);
      await h.waitFor((e) => e.type === 'bandada.ticketing.ticket.used.v1' && (e.data as { ticketId: string }).ticketId === ticketId);
      await new Promise((r) => setTimeout(r, 300));
      expect(countOf('bandada.ticketing.ticket.used.v1', 'ticketId', ticketId)).toBe(1);
    }
  });

  it('authorization and business errors', async () => {
    const { cmd, ticketId, userId } = await issueOne();
    const qr = await qrOf(ticketId, userId);

    expect((await validate(qr, { sub: userId, roles: ['STUDENT'] })).status).toBe(403);
    const foreign = await validate(qr, { sub: OTHER_ORGANIZER });
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe('NOT_EVENT_ORGANIZER');
    const mismatch = await validate(qr, { eventId: uuidv7() });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.code).toBe('TICKET_EVENT_MISMATCH');
    expect((await validate('', {})).status).toBe(422);
    expect((await request(h.http).post('/api/v1/tickets/validate').send({})).status).toBe(401);
    expect(await h.ticketItem(ticketId)).toMatchObject({ status: 'ISSUED' });
    expect(cmd.eventId).toBeDefined();
  });

  it('rejects validation outside the window (more than 2h before the event) and a signed QR without a ticket', async () => {
    const { ticketId, userId } = await issueOne({ eventStartsAt: new Date(Date.now() + 5 * 3600_000).toISOString() });
    const res = await validate(await qrOf(ticketId, userId));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_WINDOW_CLOSED');
    expect(await h.ticketItem(ticketId)).toMatchObject({ status: 'ISSUED' });

    const keys = await request(h.http).get('/api/v1/tickets/signing-keys').set('Authorization', `Bearer ${await h.token(userId, [])}`);
    expect(keys.body.keys).toHaveLength(1);
    // QR signed with a foreign key but a known kid is rejected as well
    const { generateKeyPair } = await import('jose');
    const foreign = await generateKeyPair('ES256');
    const forged = await new CompactSign(new TextEncoder().encode(JSON.stringify({ tid: ticketId, eid: uuidv7(), rid: uuidv7(), sub: userId, iat: 1 })))
      .setProtectedHeader({ alg: 'ES256', kid: 'tk-it' })
      .sign(foreign.privateKey);
    const forgedRes = await validate(forged);
    expect(forgedRes.status).toBe(422);
    expect(forgedRes.body.code).toBe('INVALID_QR_SIGNATURE');
  });
});

describe('health', () => {
  it('serves /health/live and /health/ready without auth', async () => {
    expect((await request(h.http).get('/health/live')).body).toEqual({ status: 'UP' });
    const ready = await request(h.http).get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe('UP');
  });
});
