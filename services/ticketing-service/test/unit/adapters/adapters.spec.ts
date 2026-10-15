import { createPublicKey } from 'node:crypto';

import { compactVerify, importJWK } from 'jose';

import { TicketAlreadyUsedError, ValidationWindowClosedError } from '../../../src/entities/errors/domain-errors';
import { loadConfig } from '../../../src/frameworks-drivers/config/app-config';
import { JoseQrSigner } from '../../../src/interface-adapters/gateways/crypto/jose-qr-signer.gateway';
import { problemFromDomainError } from '../../../src/interface-adapters/presenters/problem.presenter';
import { generateEs256Pem, IDS } from '../../support/fakes';

describe('JoseQrSigner', () => {
  const claims = { tid: 't', eid: 'e', rid: 'r', sub: 's', iat: 1_791_986_403 };

  it('exposes the public JWK (EC P-256, ES256, kid) and verifies externally with it', async () => {
    const signer = await JoseQrSigner.create({ privateKeyPem: generateEs256Pem(), kid: 'tk-2026-10' });
    const [jwk] = signer.publicKeys();
    expect(jwk).toMatchObject({ kty: 'EC', crv: 'P-256', kid: 'tk-2026-10', use: 'sig', alg: 'ES256' });
    expect(jwk).not.toHaveProperty('d');
    const token = await signer.sign(claims);
    const key = await importJWK(jwk as never, 'ES256');
    const { payload } = await compactVerify(token, key);
    expect(JSON.parse(new TextDecoder().decode(payload))).toEqual(claims);
    expect(createPublicKey({ key: jwk as never, format: 'jwk' }).asymmetricKeyType).toBe('ec');
  });

  it('keeps verifying tokens of a previous key during rotation', async () => {
    const old = await JoseQrSigner.create({ privateKeyPem: generateEs256Pem(), kid: 'tk-old' });
    const rotated = await JoseQrSigner.create({ privateKeyPem: generateEs256Pem(), kid: 'tk-new', previousKeys: old.publicKeys() });
    expect(rotated.publicKeys().map((k) => k.kid)).toEqual(['tk-new', 'tk-old']);
    await expect(rotated.verify(await old.sign(claims))).resolves.toEqual(claims);
  });

  it('rejects tokens with missing claims or unsigned (alg none)', async () => {
    const signer = await JoseQrSigner.create({ privateKeyPem: generateEs256Pem(), kid: 'k' });
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    await expect(signer.verify(`${b64({ alg: 'none', kid: 'k' })}.${b64(claims)}.`)).rejects.toMatchObject({ code: 'INVALID_QR_SIGNATURE' });
    await expect(signer.verify(await signer.sign({ ...claims, tid: undefined } as never))).rejects.toMatchObject({ code: 'INVALID_QR_SIGNATURE' });
  });
});

describe('problem presenter', () => {
  it('localizes TICKET_ALREADY_USED with usedAt in es and en', () => {
    const err = new TicketAlreadyUsedError(IDS.event, new Date('2026-10-20T21:48:10Z'));
    const es = problemFromDomainError(err, { locale: 'es', instance: '/api/v1/tickets/validate' });
    const en = problemFromDomainError(err, { locale: 'en', instance: '/api/v1/tickets/validate' });
    expect(es).toMatchObject({ status: 409, code: 'TICKET_ALREADY_USED', title: 'Entrada ya utilizada', ticketId: IDS.event, usedAt: '2026-10-20T21:48:10.000Z' });
    expect(es.detail).toContain('oct');
    expect(en).toMatchObject({ title: 'Ticket already used' });
    expect(en.type).toBe('https://api.bandadau.com/problems/ticket-already-used');
  });

  it('maps VALIDATION_WINDOW_CLOSED to 422', () => {
    const p = problemFromDomainError(new ValidationWindowClosedError(new Date(0), new Date(1000)), { locale: 'en' });
    expect(p.status).toBe(422);
    expect(p.code).toBe('VALIDATION_WINDOW_CLOSED');
  });
});

describe('loadConfig', () => {
  const base = { RABBITMQ_URL: 'amqp://x', JWKS_URL: 'http://j', JWT_ISSUER: 'iss', QR_SIGNING_KEY_PATH: '/k.pem' };

  it('applies defaults and parses the chaos flag once', () => {
    const cfg = loadConfig(base);
    expect(cfg).toMatchObject({ port: 7006, ticketingTable: 'bandada-ticketing', chaosTicketingFail: false, qrSigningKid: 'tk-2026-10' });
    expect(loadConfig({ ...base, CHAOS_TICKETING_FAIL: 'true' }).chaosTicketingFail).toBe(true);
  });

  it('fails fast on missing required variables', () => {
    expect(() => loadConfig({})).toThrow('RABBITMQ_URL');
  });
});
