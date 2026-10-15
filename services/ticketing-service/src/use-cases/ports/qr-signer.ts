import type { QrClaims } from '../../entities/qr-claims';

export interface PublicSigningKey {
  kty: 'EC';
  crv: 'P-256';
  kid: string;
  use: 'sig';
  alg: 'ES256';
  x: string;
  y: string;
}

export interface QrSigner {
  sign(claims: QrClaims): Promise<string>;
  /** Throws `InvalidQrSignatureError` when the token is malformed, signed with an unknown key or altered. */
  verify(token: string): Promise<QrClaims>;
  publicKeys(): PublicSigningKey[];
}
export const QR_SIGNER = Symbol('QrSigner');
