import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { embedProvisioningProfile } from '../src/provisioning';

describe('embedProvisioningProfile', () => {
  let appDir: string;

  beforeEach(() => {
    appDir = mkdtempSync(join(tmpdir(), 'repacker-provisioning-'));
  });

  afterEach(() => {
    rmSync(appDir, { recursive: true, force: true });
  });

  it('writes the exact raw bytes to embedded.mobileprovision at the app root', async () => {
    const profileBytes = Buffer.from('fake PKCS#7 provisioning profile bytes');
    await embedProvisioningProfile(appDir, profileBytes);
    const written = readFileSync(join(appDir, 'embedded.mobileprovision'));
    expect(written.equals(profileBytes)).toBe(true);
  });
});
