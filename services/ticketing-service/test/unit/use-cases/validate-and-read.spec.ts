import {
  InvalidQrSignatureError,
  NotEventOrganizerError,
  TicketAccessDeniedError,
  TicketAlreadyUsedError,
  TicketEventMismatchError,
  TicketNotFoundError,
  TicketVoidedError,
  ValidationWindowClosedError,
} from '../../../src/entities/errors/domain-errors';
import { JoseQrSigner } from '../../../src/interface-adapters/gateways/crypto/jose-qr-signer.gateway';
import { GetTicketUseCase } from '../../../src/use-cases/get-ticket/get-ticket.use-case';
import { ValidateTicketUseCase } from '../../../src/use-cases/validate-ticket/validate-ticket.use-case';
import { FixedClock, generateEs256Pem, IDS, InMemoryTicketRepository, RecordingPublisher, sampleTicket } from '../../support/fakes';

const inWindow = new Date('2026-10-20T21:48:10Z');
const options = { window: { opensBeforeStartMs: 2 * 3600_000, defaultDurationMs: 12 * 3600_000 }, strictOrganizerCheck: false };
const organizer = { id: IDS.organizer, roles: ['STUDENT', 'ORGANIZER'] };

async function setup(strict = false) {
  const signer = await JoseQrSigner.create({ privateKeyPem: generateEs256Pem(), kid: 'tk-test' });
  const repo = new InMemoryTicketRepository();
  const publisher = new RecordingPublisher();
  const clock = new FixedClock(inWindow);
  const ticket = sampleTicket();
  repo.tickets.set(ticket.id, ticket);
  const qr = await new GetTicketUseCase(repo, signer).execute({ ticketId: ticket.id, actor: { id: IDS.user, roles: ['STUDENT'] } });
  const validate = new ValidateTicketUseCase(repo, signer, publisher, clock, { ...options, strictOrganizerCheck: strict });
  return { signer, repo, publisher, clock, ticket, qr: qr.qrPayload, validate };
}

describe('ValidateTicketUseCase', () => {
  it('marks the ticket USED and records ticket.used.v1', async () => {
    const s = await setup();
    const result = await s.validate.execute({ qrPayload: s.qr, eventId: IDS.event, actor: organizer, trace: {} });
    expect(result.status).toBe('USED');
    expect(s.repo.tickets.get(s.ticket.id)).toMatchObject({ usedBy: IDS.organizer });
    expect(s.repo.outbox.map((m) => m.type)).toEqual(['bandada.ticketing.ticket.used.v1']);
    expect(s.repo.outbox[0]?.data).toMatchObject({ validatedBy: IDS.organizer, ticketId: s.ticket.id });
  });

  it('answers TICKET_ALREADY_USED the second time (with usedAt)', async () => {
    const s = await setup();
    await s.validate.execute({ qrPayload: s.qr, actor: organizer, trace: {} });
    await expect(s.validate.execute({ qrPayload: s.qr, actor: organizer, trace: {} })).rejects.toMatchObject({
      constructor: TicketAlreadyUsedError,
      usedAt: inWindow,
    });
  });

  it('answers TICKET_VOIDED for a voided ticket', async () => {
    const s = await setup();
    s.repo.tickets.set(s.ticket.id, s.ticket.void(new Date()));
    await expect(s.validate.execute({ qrPayload: s.qr, actor: organizer, trace: {} })).rejects.toBeInstanceOf(TicketVoidedError);
  });

  it('rejects an altered QR with INVALID_QR_SIGNATURE', async () => {
    const s = await setup();
    const [h, p, sig] = s.qr.split('.') as [string, string, string];
    const tampered = `${h}.${p}.${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
    await expect(s.validate.execute({ qrPayload: tampered, actor: organizer, trace: {} })).rejects.toBeInstanceOf(InvalidQrSignatureError);
    await expect(s.validate.execute({ qrPayload: 'not-a-jws', actor: organizer, trace: {} })).rejects.toBeInstanceOf(InvalidQrSignatureError);
  });

  it('rejects a QR signed by another key', async () => {
    const s = await setup();
    const foreign = await JoseQrSigner.create({ privateKeyPem: generateEs256Pem(), kid: 'tk-test' });
    const qr = await foreign.sign({ tid: s.ticket.id, eid: IDS.event, rid: IDS.registration, sub: IDS.user, iat: 1 });
    await expect(s.validate.execute({ qrPayload: qr, actor: organizer, trace: {} })).rejects.toBeInstanceOf(InvalidQrSignatureError);
  });

  it('rejects another event with TICKET_EVENT_MISMATCH', async () => {
    const s = await setup();
    await expect(
      s.validate.execute({ qrPayload: s.qr, eventId: '0192a3be-1234-7abc-8def-0000000000ff', actor: organizer, trace: {} }),
    ).rejects.toBeInstanceOf(TicketEventMismatchError);
  });

  it('returns TICKET_NOT_FOUND for a signed QR without a stored ticket', async () => {
    const s = await setup();
    s.repo.tickets.clear();
    await expect(s.validate.execute({ qrPayload: s.qr, actor: organizer, trace: {} })).rejects.toBeInstanceOf(TicketNotFoundError);
  });

  it('only lets the organizer, the staff or an ADMIN validate', async () => {
    const s = await setup();
    await expect(
      s.validate.execute({ qrPayload: s.qr, actor: { id: IDS.other, roles: ['ORGANIZER'] }, trace: {} }),
    ).rejects.toBeInstanceOf(NotEventOrganizerError);
    await expect(
      s.validate.execute({ qrPayload: s.qr, actor: { id: IDS.user, roles: ['STUDENT'] }, trace: {} }),
    ).rejects.toBeInstanceOf(NotEventOrganizerError);
    await expect(s.validate.execute({ qrPayload: s.qr, actor: { id: IDS.other, roles: ['ADMIN'] }, trace: {} })).resolves.toBeDefined();
  });

  it('accepts staff listed in the issue command', async () => {
    const s = await setup();
    const withStaff = sampleTicket({ staffUserIds: [IDS.other] });
    s.repo.tickets.set(withStaff.id, withStaff);
    await expect(
      s.validate.execute({ qrPayload: s.qr, actor: { id: IDS.other, roles: ['ORGANIZER'] }, trace: {} }),
    ).resolves.toBeDefined();
  });

  it('without organizer data any ORGANIZER may validate, unless the check is strict', async () => {
    const lenient = await setup(false);
    const noOrganizer = sampleTicket({ organizerId: null });
    lenient.repo.tickets.set(noOrganizer.id, noOrganizer);
    await expect(
      lenient.validate.execute({ qrPayload: lenient.qr, actor: { id: IDS.other, roles: ['ORGANIZER'] }, trace: {} }),
    ).resolves.toBeDefined();

    const strict = await setup(true);
    strict.repo.tickets.set(noOrganizer.id, noOrganizer);
    await expect(
      strict.validate.execute({ qrPayload: strict.qr, actor: { id: IDS.other, roles: ['ORGANIZER'] }, trace: {} }),
    ).rejects.toBeInstanceOf(NotEventOrganizerError);
  });

  it('enforces the validation window (startsAt - 2h ... end)', async () => {
    const s = await setup();
    s.clock.set(new Date('2026-10-20T19:00:00Z'));
    await expect(s.validate.execute({ qrPayload: s.qr, actor: organizer, trace: {} })).rejects.toBeInstanceOf(ValidationWindowClosedError);
    s.clock.set(new Date('2026-10-22T00:00:00Z'));
    await expect(s.validate.execute({ qrPayload: s.qr, actor: organizer, trace: {} })).rejects.toBeInstanceOf(ValidationWindowClosedError);
  });

  it('retries after a transient transaction conflict', async () => {
    const s = await setup();
    s.repo.failNextMarkUsed = 1;
    await expect(s.validate.execute({ qrPayload: s.qr, actor: organizer, trace: {} })).resolves.toMatchObject({ status: 'USED' });
  });
});

describe('GetTicketUseCase', () => {
  it('returns a QR with the claims tid, eid, rid, sub, iat that verifies with the signer', async () => {
    const s = await setup();
    const claims = await s.signer.verify(s.qr);
    expect(claims).toEqual({
      tid: s.ticket.id,
      eid: IDS.event,
      rid: IDS.registration,
      sub: IDS.user,
      iat: Math.floor(s.ticket.issuedAt.getTime() / 1000),
    });
    const [header] = s.qr.split('.') as [string];
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'tk-test' });
  });

  it('denies another user but allows an ADMIN', async () => {
    const s = await setup();
    const uc = new GetTicketUseCase(s.repo, s.signer);
    await expect(uc.execute({ ticketId: s.ticket.id, actor: { id: IDS.other, roles: ['STUDENT'] } })).rejects.toBeInstanceOf(TicketAccessDeniedError);
    await expect(uc.execute({ ticketId: s.ticket.id, actor: { id: IDS.other, roles: ['ADMIN'] } })).resolves.toBeDefined();
    await expect(uc.execute({ ticketId: 'missing', actor: { id: IDS.user, roles: [] } })).rejects.toBeInstanceOf(TicketNotFoundError);
  });
});
