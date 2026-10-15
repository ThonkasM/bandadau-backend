/** Claims of the signed QR (UC-14): no personal data beyond ids. `iat` is epoch seconds. */
export interface QrClaims {
  readonly tid: string;
  readonly eid: string;
  readonly rid: string;
  readonly sub: string;
  readonly iat: number;
}
