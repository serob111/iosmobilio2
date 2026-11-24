import { describe, expect, it, vi } from 'vitest';

const mockValidateAppleEnv = vi.hoisted(() => vi.fn());
vi.mock('@mobilio/apple', () => ({ validateAppleEnv: mockValidateAppleEnv }));

const { loadRepackJobConfig } = await import('../src/repack-config');

const FAKE_APPLE_ENV_CREDENTIALS = {
  ascCredentials: { issuerId: 'i', keyId: 'k', privateKeyPem: 'pem' },
  signingP12Base64: 'base64',
  signingP12Password: 'pw',
  distributionCertId: 'cert-1',
  teamId: 'TEAM1',
};

describe('loadRepackJobConfig', () => {
  it('returns the full config when every var is set and validateAppleEnv succeeds', () => {
    mockValidateAppleEnv.mockReturnValue(FAKE_APPLE_ENV_CREDENTIALS);
    const env = { RCODESIGN_PATH: '/usr/local/bin/rcodesign', RCODESIGN_SHA256: 'abc123', REPACK_CACHE_DIR: '/data/cache' };

    const config = loadRepackJobConfig(env);

    expect(config).toEqual({
      cacheDir: '/data/cache',
      rcodesign: { binaryPath: '/usr/local/bin/rcodesign', expectedSha256: 'abc123' },
      appleEnv: FAKE_APPLE_ENV_CREDENTIALS,
    });
    expect(mockValidateAppleEnv).toHaveBeenCalledWith(env);
  });

  it('defaults REPACK_CACHE_DIR when unset', () => {
    mockValidateAppleEnv.mockReturnValue(FAKE_APPLE_ENV_CREDENTIALS);
    const config = loadRepackJobConfig({ RCODESIGN_PATH: '/bin/rcodesign', RCODESIGN_SHA256: 'abc' });
    expect(config.cacheDir).toBe('/tmp/mobilio-repack-cache');
  });

  it('throws naming RCODESIGN_PATH when missing', () => {
    expect(() => loadRepackJobConfig({ RCODESIGN_SHA256: 'abc' })).toThrow(/RCODESIGN_PATH/);
  });

  it('throws naming RCODESIGN_SHA256 when missing', () => {
    expect(() => loadRepackJobConfig({ RCODESIGN_PATH: '/bin/rcodesign' })).toThrow(/RCODESIGN_SHA256/);
  });

  it('throws naming both when neither is set', () => {
    expect(() => loadRepackJobConfig({})).toThrow(/RCODESIGN_PATH.*RCODESIGN_SHA256/s);
  });

  it('propagates a validateAppleEnv failure (e.g. missing ASC_* vars)', () => {
    mockValidateAppleEnv.mockImplementation(() => {
      throw new Error('Missing required App Store Connect / signing env var(s): ASC_ISSUER_ID');
    });
    expect(() => loadRepackJobConfig({ RCODESIGN_PATH: '/bin/rcodesign', RCODESIGN_SHA256: 'abc' })).toThrow(/ASC_ISSUER_ID/);
  });
});
