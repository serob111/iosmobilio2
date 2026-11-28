import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateAppleEnv, withP12FromBase64 } from '../src/env';

const VALID_ENV = {
  ASC_ISSUER_ID: 'issuer-1',
  ASC_KEY_ID: 'KEY123',
  ASC_PRIVATE_KEY: '-----BEGIN EC PRIVATE KEY-----\nabc\n-----END EC PRIVATE KEY-----',
  SIGNING_P12_BASE64: Buffer.from('fake p12 bytes').toString('base64'),
  SIGNING_P12_PASSWORD: 'super-secret',
  ASC_DISTRIBUTION_CERT_ID: 'cert-123',
  APPLE_TEAM_ID: 'ABCDE12345',
};

describe('validateAppleEnv', () => {
  it('returns parsed credentials when every required var is set', () => {
    const result = validateAppleEnv(VALID_ENV);
    expect(result).toEqual({
      ascCredentials: { issuerId: 'issuer-1', keyId: 'KEY123', privateKeyPem: VALID_ENV.ASC_PRIVATE_KEY },
      signingP12Base64: VALID_ENV.SIGNING_P12_BASE64,
      signingP12Password: 'super-secret',
      distributionCertId: 'cert-123',
      teamId: 'ABCDE12345',
    });
  });

  it('normalizes a literal \\n-escaped PEM into real newlines', () => {
    const result = validateAppleEnv({ ...VALID_ENV, ASC_PRIVATE_KEY: '-----BEGIN EC PRIVATE KEY-----\\nabc\\n-----END EC PRIVATE KEY-----' });
    expect(result.ascCredentials.privateKeyPem).toBe('-----BEGIN EC PRIVATE KEY-----\nabc\n-----END EC PRIVATE KEY-----');
  });

  it('leaves an already-real-newline PEM untouched', () => {
    const result = validateAppleEnv(VALID_ENV);
    expect(result.ascCredentials.privateKeyPem).toBe(VALID_ENV.ASC_PRIVATE_KEY);
  });

  it.each(['ASC_ISSUER_ID', 'ASC_KEY_ID', 'ASC_PRIVATE_KEY', 'SIGNING_P12_BASE64', 'SIGNING_P12_PASSWORD', 'ASC_DISTRIBUTION_CERT_ID', 'APPLE_TEAM_ID'])(
    'throws naming the missing var, without ever including the value, when %s is unset',
    (missingVar) => {
      const env = { ...VALID_ENV, [missingVar]: undefined };
      expect(() => validateAppleEnv(env)).toThrow(missingVar);
      try {
        validateAppleEnv(env);
      } catch (error) {
        expect((error as Error).message).not.toContain('super-secret');
      }
    },
  );

  it('reports every missing var at once, not just the first', () => {
    expect(() => validateAppleEnv({})).toThrow(
      /ASC_ISSUER_ID.*ASC_KEY_ID.*ASC_PRIVATE_KEY.*SIGNING_P12_BASE64.*SIGNING_P12_PASSWORD.*ASC_DISTRIBUTION_CERT_ID.*APPLE_TEAM_ID/s,
    );
  });
});

describe('withP12FromBase64', () => {
  it('writes the decoded bytes to a 0600 file and passes its path to fn', async () => {
    const base64 = Buffer.from('real p12 content').toString('base64');
    let capturedPath = '';
    await withP12FromBase64(base64, async (p12Path) => {
      capturedPath = p12Path;
      expect(readFileSync(p12Path, 'utf8')).toBe('real p12 content');
      if (process.platform !== 'win32') {
        expect(statSync(p12Path).mode & 0o777).toBe(0o600);
      }
    });
    expect(() => readFileSync(capturedPath)).toThrow();
  });

  it('deletes the temp file even when fn throws', async () => {
    const base64 = Buffer.from('content').toString('base64');
    let capturedPath = '';
    await expect(
      withP12FromBase64(base64, async (p12Path) => {
        capturedPath = p12Path;
        throw new Error('signing failed');
      }),
    ).rejects.toThrow('signing failed');
    expect(() => readFileSync(capturedPath)).toThrow();
  });

  it('returns fn\'s own resolved value', async () => {
    const result = await withP12FromBase64(Buffer.from('x').toString('base64'), async () => 'ok');
    expect(result).toBe('ok');
  });
});
