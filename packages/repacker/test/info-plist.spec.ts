import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyClientIdentity, readInfoPlist, writeInfoPlist, type InfoPlistDict } from '../src/info-plist';
import { RepackError } from '../src/errors';

function baseInfoPlist(overrides: Partial<InfoPlistDict> = {}): InfoPlistDict {
  return {
    CFBundleIdentifier: 'am.mobilio.shell.base',
    CFBundleDisplayName: 'Mobilio',
    CFBundleName: 'Mobilio',
    CFBundleShortVersionString: '1.0.0',
    CFBundleVersion: '1',
    CFBundleExecutable: 'MobilioShell',
    CFBundleIcons: { CFBundlePrimaryIcon: { CFBundleIconFiles: ['AppIcon60x60@2x.png'] } },
    ...overrides,
  };
}

describe('applyClientIdentity', () => {
  it('sets identifier, display name, name, version fields, and a URL scheme derived from bundleId', () => {
    const result = applyClientIdentity(baseInfoPlist(), {
      bundleId: 'am.mobilio.t.abc123',
      displayName: 'Cafe Mobilio',
      shortVersion: '2.1.0',
      buildNumber: '42',
    });
    expect(result).toMatchObject({
      CFBundleIdentifier: 'am.mobilio.t.abc123',
      CFBundleDisplayName: 'Cafe Mobilio',
      CFBundleName: 'Cafe Mobilio',
      CFBundleShortVersionString: '2.1.0',
      CFBundleVersion: '42',
      CFBundleURLTypes: [{ CFBundleURLName: 'am.mobilio.t.abc123', CFBundleURLSchemes: ['am-mobilio-t-abc123'] }],
    });
  });

  it('preserves fields it does not touch, like CFBundleExecutable', () => {
    const result = applyClientIdentity(baseInfoPlist(), {
      bundleId: 'am.mobilio.t.abc123',
      displayName: 'Cafe Mobilio',
      shortVersion: '2.1.0',
      buildNumber: '42',
    });
    expect(result.CFBundleExecutable).toBe('MobilioShell');
  });

  it('does not mutate the input object', () => {
    const input = baseInfoPlist();
    applyClientIdentity(input, { bundleId: 'am.mobilio.t.x', displayName: 'X', shortVersion: '1', buildNumber: '1' });
    expect(input.CFBundleIdentifier).toBe('am.mobilio.shell.base');
  });

  it('trims whitespace from displayName', () => {
    const result = applyClientIdentity(baseInfoPlist(), {
      bundleId: 'am.mobilio.t.x',
      displayName: '  Cafe Mobilio  ',
      shortVersion: '1',
      buildNumber: '1',
    });
    expect(result.CFBundleDisplayName).toBe('Cafe Mobilio');
  });

  it('throws INVALID_CONFIG for a displayName over 30 characters (after trimming)', () => {
    expect(() =>
      applyClientIdentity(baseInfoPlist(), {
        bundleId: 'am.mobilio.t.x',
        displayName: 'a'.repeat(31),
        shortVersion: '1',
        buildNumber: '1',
      }),
    ).toThrow(RepackError);
  });

  it('allows exactly 30 characters', () => {
    expect(() =>
      applyClientIdentity(baseInfoPlist(), {
        bundleId: 'am.mobilio.t.x',
        displayName: 'a'.repeat(30),
        shortVersion: '1',
        buildNumber: '1',
      }),
    ).not.toThrow();
  });

  it('throws INVALID_CONFIG for a displayName that is empty after trimming', () => {
    expect(() =>
      applyClientIdentity(baseInfoPlist(), { bundleId: 'am.mobilio.t.x', displayName: '   ', shortVersion: '1', buildNumber: '1' }),
    ).toThrow(RepackError);
  });

  it('throws INVALID_CONFIG for a displayName containing a control character', () => {
    expect(() =>
      applyClientIdentity(baseInfoPlist(), {
        bundleId: 'am.mobilio.t.x',
        displayName: 'Cafe\x07Mobilio',
        shortVersion: '1',
        buildNumber: '1',
      }),
    ).toThrow(RepackError);
  });

  it('throws INVALID_CONFIG for a malformed bundleId', () => {
    expect(() =>
      applyClientIdentity(baseInfoPlist(), { bundleId: 'not a bundle id!', displayName: 'X', shortVersion: '1', buildNumber: '1' }),
    ).toThrow(RepackError);
  });

  it('throws INVALID_CONFIG if the input plist already has CFBundleIconName', () => {
    expect(() =>
      applyClientIdentity(baseInfoPlist({ CFBundleIconName: 'AppIcon' }), {
        bundleId: 'am.mobilio.t.x',
        displayName: 'X',
        shortVersion: '1',
        buildNumber: '1',
      }),
    ).toThrow(/CFBundleIconName must stay absent/);
  });
});

describe('readInfoPlist / writeInfoPlist', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'repacker-infoplist-'));
    path = join(dir, 'Info.plist');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a plist through binary format, including a nested structure', async () => {
    const original = baseInfoPlist();
    await writeInfoPlist(path, original);
    const reread = await readInfoPlist(path);
    expect(reread).toEqual(original);
  });

  it('writes a file that starts with the bplist00 magic', async () => {
    await writeInfoPlist(path, baseInfoPlist());
    const { readFileSync } = await import('node:fs');
    const header = readFileSync(path).subarray(0, 8).toString('ascii');
    expect(header).toBe('bplist00');
  });

  it('full round trip: read, edit via applyClientIdentity, write, re-read', async () => {
    await writeInfoPlist(path, baseInfoPlist());
    const read = await readInfoPlist(path);
    const edited = applyClientIdentity(read, {
      bundleId: 'am.mobilio.t.cafe',
      displayName: 'Cafe Mobilio',
      shortVersion: '1.0.0',
      buildNumber: '1',
    });
    await writeInfoPlist(path, edited);
    const final = await readInfoPlist(path);
    expect(final.CFBundleIdentifier).toBe('am.mobilio.t.cafe');
    expect(final.CFBundleExecutable).toBe('MobilioShell');
  });
});
