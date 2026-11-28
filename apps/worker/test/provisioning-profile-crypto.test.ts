import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { decryptProvisioningProfile, encryptProvisioningProfile } from '../src/provisioning-profile-crypto';

const KEY_A = randomBytes(32).toString('base64');
const KEY_B = randomBytes(32).toString('base64');

describe('provisioning profile encryption (AES-256-GCM)', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('round-trips: decrypting with the same key recovers the exact raw bytes', () => {
    process.env.PROVISIONING_PROFILE_KEY = KEY_A;
    const profileContent = Buffer.from([0x30, 0x82, 0x01, 0x00, 0xff, 0x00, 0x01]); // arbitrary binary PKCS#7-ish bytes
    const encrypted = encryptProvisioningProfile(profileContent);
    expect(decryptProvisioningProfile(encrypted).equals(profileContent)).toBe(true);
  });

  it('produces a different ciphertext every time (random IV), even for the same input', () => {
    process.env.PROVISIONING_PROFILE_KEY = KEY_A;
    const content = Buffer.from('same profile bytes');
    const first = encryptProvisioningProfile(content);
    const second = encryptProvisioningProfile(content);
    expect(first).not.toBe(second);
  });

  it('throws when decrypting with the wrong key', () => {
    process.env.PROVISIONING_PROFILE_KEY = KEY_A;
    const encrypted = encryptProvisioningProfile(Buffer.from('secret profile'));

    process.env.PROVISIONING_PROFILE_KEY = KEY_B;
    expect(() => decryptProvisioningProfile(encrypted)).toThrow();
  });

  it('throws when the ciphertext has been tampered with', () => {
    process.env.PROVISIONING_PROFILE_KEY = KEY_A;
    const encrypted = encryptProvisioningProfile(Buffer.from('secret profile'));
    const tampered = Buffer.from(encrypted, 'base64');
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
    expect(() => decryptProvisioningProfile(tampered.toString('base64'))).toThrow();
  });

  it('throws when PROVISIONING_PROFILE_KEY is missing', () => {
    delete process.env.PROVISIONING_PROFILE_KEY;
    expect(() => encryptProvisioningProfile(Buffer.from('x'))).toThrow(/PROVISIONING_PROFILE_KEY/);
  });

  it('throws when PROVISIONING_PROFILE_KEY does not decode to 32 bytes', () => {
    process.env.PROVISIONING_PROFILE_KEY = Buffer.from('too-short').toString('base64');
    expect(() => encryptProvisioningProfile(Buffer.from('x'))).toThrow(/32 bytes/);
  });

  it('throws on a malformed (too-short) ciphertext blob', () => {
    process.env.PROVISIONING_PROFILE_KEY = KEY_A;
    expect(() => decryptProvisioningProfile(Buffer.from('short').toString('base64'))).toThrow(/malformed/);
  });
});
