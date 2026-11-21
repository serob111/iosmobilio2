import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAscJwt, MAX_ASC_JWT_LIFETIME_SECONDS } from '../src/jwt';

function generateP256KeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    privateKeyPem: privateKey.export({ type: 'sec1', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

describe('createAscJwt', () => {
  it('produces a three-segment JWT with the expected header', () => {
    const { privateKeyPem } = generateP256KeyPair();
    const jwt = createAscJwt({ issuerId: 'issuer-1', keyId: 'KEY123', privateKeyPem });
    const segments = jwt.split('.');
    expect(segments).toHaveLength(3);
    expect(decodeSegment(segments[0]!)).toEqual({ alg: 'ES256', kid: 'KEY123', typ: 'JWT' });
  });

  it('sets iss/aud and an exp exactly MAX_ASC_JWT_LIFETIME_SECONDS after iat', () => {
    const { privateKeyPem } = generateP256KeyPair();
    const now = 1_700_000_000;
    const jwt = createAscJwt({ issuerId: 'issuer-42', keyId: 'KEY123', privateKeyPem }, now);
    const payload = decodeSegment(jwt.split('.')[1]!) as Record<string, unknown>;
    expect(payload).toEqual({ iss: 'issuer-42', iat: now, exp: now + MAX_ASC_JWT_LIFETIME_SECONDS, aud: 'appstoreconnect-v1' });
  });

  it('produces a signature verifiable by an independent ES256 verifier against the matching public key', () => {
    const { privateKeyPem, publicKeyPem } = generateP256KeyPair();
    const jwt = createAscJwt({ issuerId: 'issuer-1', keyId: 'KEY123', privateKeyPem });
    const [header, payload, signature] = jwt.split('.');

    const ok = createVerify('SHA256')
      .update(`${header}.${payload}`)
      .verify({ key: publicKeyPem, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature!, 'base64url'));
    expect(ok).toBe(true);
  });

  it('rejects verification against a different keypair', () => {
    const { privateKeyPem } = generateP256KeyPair();
    const { publicKeyPem: wrongPublicKeyPem } = generateP256KeyPair();
    const jwt = createAscJwt({ issuerId: 'issuer-1', keyId: 'KEY123', privateKeyPem });
    const [header, payload, signature] = jwt.split('.');

    const ok = createVerify('SHA256')
      .update(`${header}.${payload}`)
      .verify({ key: wrongPublicKeyPem, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature!, 'base64url'));
    expect(ok).toBe(false);
  });

  it('produces a raw (ieee-p1363) 64-byte signature for a P-256 key, not ASN.1 DER', () => {
    const { privateKeyPem } = generateP256KeyPair();
    const jwt = createAscJwt({ issuerId: 'issuer-1', keyId: 'KEY123', privateKeyPem });
    const signature = Buffer.from(jwt.split('.')[2]!, 'base64url');
    expect(signature.length).toBe(64);
  });
});
