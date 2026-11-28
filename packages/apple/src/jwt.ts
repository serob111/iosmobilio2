import { createSign } from 'node:crypto';

export type AscCredentials = {
  issuerId: string;
  keyId: string;
  /** PEM-encoded EC (P-256) private key — the contents of the .p8 file App Store Connect gives you when you create the API key. */
  privateKeyPem: string;
};

const ASC_JWT_AUDIENCE = 'appstoreconnect-v1';
/** Apple's own documented hard cap on an App Store Connect API JWT's lifetime. */
export const MAX_ASC_JWT_LIFETIME_SECONDS = 20 * 60;

function base64url(input: Buffer | string): string {
  return (typeof input === 'string' ? Buffer.from(input) : input).toString('base64url');
}

/**
 * Signs an ES256 JWT for the App Store Connect API by hand, via node:crypto, rather
 * than pulling in `jose`/`jsonwebtoken` for what's a three-line algorithm. The one
 * non-obvious part: Node's default ECDSA signature encoding is ASN.1 DER, but JWS's
 * ES256 requires the raw concatenated r||s format instead — `dsaEncoding: 'ieee-p1363'`
 * is what produces that. Verified against both a hand-rolled verifier and `jose`'s own
 * jwtVerify() against a real P-256 keypair before relying on this.
 */
export function createAscJwt(credentials: AscCredentials, nowSeconds: number = Math.floor(Date.now() / 1000)): string {
  const header = { alg: 'ES256', kid: credentials.keyId, typ: 'JWT' };
  const payload = {
    iss: credentials.issuerId,
    iat: nowSeconds,
    exp: nowSeconds + MAX_ASC_JWT_LIFETIME_SECONDS,
    aud: ASC_JWT_AUDIENCE,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign('SHA256').update(signingInput).sign({ key: credentials.privateKeyPem, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${base64url(signature)}`;
}
