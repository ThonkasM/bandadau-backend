import { createPrivateKey, createPublicKey } from 'node:crypto';

import { CompactSign, compactVerify, type CryptoKey, importJWK, importPKCS8, type JWK } from 'jose';

import { InvalidQrSignatureError } from '../../../entities/errors/domain-errors';
import type { QrClaims } from '../../../entities/qr-claims';
import type { PublicSigningKey, QrSigner } from '../../../use-cases/ports/qr-signer';

export interface JoseQrSignerOptions {
  privateKeyPem: string;
  kid: string;
  /** Public keys of rotated-out signers, still accepted for verification. */
  previousKeys?: PublicSigningKey[];
}

const toPublicKey = (jwk: JWK, kid: string): PublicSigningKey => ({
  kty: 'EC',
  crv: 'P-256',
  kid,
  use: 'sig',
  alg: 'ES256',
  x: jwk.x as string,
  y: jwk.y as string,
});

/** ES256 JWS compact signer/verifier (ADR-0016). Create with `JoseQrSigner.create`. */
export class JoseQrSigner implements QrSigner {
  private constructor(
    private readonly kid: string,
    private readonly privateKey: CryptoKey,
    private readonly keys: Map<string, { jwk: PublicSigningKey; key: CryptoKey }>,
  ) {}

  static async create(options: JoseQrSignerOptions): Promise<JoseQrSigner> {
    const privateKey = await importPKCS8(options.privateKeyPem, 'ES256');
    const activeJwk = toPublicKey(createPublicKey(createPrivateKey(options.privateKeyPem)).export({ format: 'jwk' }), options.kid);
    const keys = new Map<string, { jwk: PublicSigningKey; key: CryptoKey }>();
    for (const jwk of [activeJwk, ...(options.previousKeys ?? [])]) {
      keys.set(jwk.kid, { jwk, key: (await importJWK(jwk, 'ES256')) as CryptoKey });
    }
    return new JoseQrSigner(options.kid, privateKey, keys);
  }

  async sign(claims: QrClaims): Promise<string> {
    return new CompactSign(new TextEncoder().encode(JSON.stringify(claims)))
      .setProtectedHeader({ alg: 'ES256', kid: this.kid })
      .sign(this.privateKey);
  }

  async verify(token: string): Promise<QrClaims> {
    try {
      const { payload, protectedHeader } = await compactVerify(
        token,
        async (header) => {
          const entry = typeof header.kid === 'string' ? this.keys.get(header.kid) : undefined;
          if (!entry) throw new Error('unknown kid');
          return entry.key;
        },
        { algorithms: ['ES256'] },
      );
      if (protectedHeader.alg !== 'ES256') throw new Error('alg');
      const claims = JSON.parse(new TextDecoder().decode(payload)) as Partial<QrClaims>;
      if (
        typeof claims.tid !== 'string' ||
        typeof claims.eid !== 'string' ||
        typeof claims.rid !== 'string' ||
        typeof claims.sub !== 'string' ||
        typeof claims.iat !== 'number'
      ) {
        throw new Error('claims');
      }
      return { tid: claims.tid, eid: claims.eid, rid: claims.rid, sub: claims.sub, iat: claims.iat };
    } catch {
      throw new InvalidQrSignatureError();
    }
  }

  publicKeys(): PublicSigningKey[] {
    return [...this.keys.values()].map((entry) => entry.jwk);
  }
}
