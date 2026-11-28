import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createZip } from '../src/archive';
import { sha256File } from '../src/checksum';
import { RepackError } from '../src/errors';
import { writeInfoPlist } from '../src/info-plist';

const mockSignBundle = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockVerifyBundle = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../src/sign.js', () => ({ signBundle: mockSignBundle, verifyBundle: mockVerifyBundle }));

const { repack } = await import('../src/repack');

async function makeSquarePng(size: number): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } })
    .png()
    .toBuffer();
}

const VALID_CONFIG = {
  id: 'p1',
  name: 'Cafe Mobilio',
  slug: 'cafe-mobilio',
  bundleId: 'am.mobilio.t.cafe',
  source: { type: 'url', url: 'https://cafe-mobilio.example' },
  theme: { primary: '#2563EB', background: '#FFFFFF', statusBar: 'dark' },
  tabs: [{ title: 'Home', icon: 'home', path: '/' }],
  features: { offline: true, share: true, deepLinks: true, pullToRefresh: true, push: false },
  allowedDomains: ['cafe-mobilio.example'],
  trial: true,
};

async function buildBaseIpa(root: string): Promise<{ baseIpaPath: string; baseSha256: string }> {
  const sourceDir = join(root, 'base-source');
  const appDir = join(sourceDir, 'Payload', 'Base.app');
  const mobilioDir = join(appDir, 'mobilio');
  mkdirSync(mobilioDir, { recursive: true });

  await writeInfoPlist(join(appDir, 'Info.plist'), {
    CFBundleExecutable: 'Base',
    CFBundleIdentifier: 'am.mobilio.shell.base',
    CFBundleDisplayName: 'Mobilio',
    CFBundleShortVersionString: '1.0.0',
    CFBundleVersion: '1',
  });
  writeFileSync(join(appDir, 'Base'), Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));
  writeFileSync(join(mobilioDir, 'config.json'), JSON.stringify({ demo: true }));
  writeFileSync(join(mobilioDir, 'splash.png'), 'demo splash placeholder');

  const baseIpaPath = join(root, 'base.ipa');
  await createZip(sourceDir, baseIpaPath);
  const baseSha256 = await sha256File(baseIpaPath);
  return { baseIpaPath, baseSha256 };
}

describe('repack', () => {
  let root: string;
  let workDir: string;
  let outputIpaPath: string;
  let baseIpaPath: string;
  let baseSha256: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'repacker-orchestrator-'));
    workDir = join(root, 'work');
    outputIpaPath = join(root, 'out.ipa');
    ({ baseIpaPath, baseSha256 } = await buildBaseIpa(root));
    mockSignBundle.mockClear().mockResolvedValue(undefined);
    mockVerifyBundle.mockClear().mockResolvedValue(undefined);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function baseInput(overrides: Partial<Parameters<typeof repack>[0]> = {}) {
    return {
      baseIpaPath,
      baseSha256,
      workDir,
      outputIpaPath,
      rawConfig: VALID_CONFIG,
      iconPng1024: undefined as unknown as Buffer,
      bundleId: 'am.mobilio.t.cafe',
      displayName: 'Cafe Mobilio',
      shortVersion: '1.2.3',
      buildNumber: '7',
      teamId: 'ABCDE12345',
      provisioningProfile: Buffer.from('fake provisioning profile bytes'),
      signing: { p12Path: join(root, 'cert.p12'), p12Password: 'secret' },
      rcodesign: { binaryPath: join(root, 'rcodesign'), expectedSha256: 'unused-because-signing-is-mocked' },
      ...overrides,
    };
  }

  it('produces a signed .ipa with the client identity, icons, config, entitlements, and profile all applied', async () => {
    const icon = await makeSquarePng(1024);
    const result = await repack(baseInput({ iconPng1024: icon }));

    expect(result.outputIpaPath).toBe(outputIpaPath);
    expect(mockSignBundle).toHaveBeenCalledTimes(1);
    expect(mockVerifyBundle).toHaveBeenCalledTimes(1);

    const extractDir = join(root, 'verify-extract');
    const { extractZip } = await import('../src/extract');
    await extractZip(outputIpaPath, extractDir);
    const appDir = join(extractDir, 'Payload', 'Base.app');

    const { readInfoPlist } = await import('../src/info-plist');
    const plist = await readInfoPlist(join(appDir, 'Info.plist'));
    expect(plist.CFBundleIdentifier).toBe('am.mobilio.t.cafe');
    expect(plist.CFBundleDisplayName).toBe('Cafe Mobilio');
    expect(plist.CFBundleShortVersionString).toBe('1.2.3');
    expect(plist.CFBundleVersion).toBe('7');

    const config = JSON.parse(readFileSync(join(appDir, 'mobilio', 'config.json'), 'utf8'));
    expect(config.bundleId).toBe('am.mobilio.t.cafe');

    expect(readFileSync(join(appDir, 'embedded.mobileprovision'), 'utf8')).toBe('fake provisioning profile bytes');

    const { ICON_FILES } = await import('../src/icons');
    for (const [filename] of ICON_FILES) {
      expect(() => readFileSync(join(appDir, filename))).not.toThrow();
    }
  });

  it('passes applinks associated domains to signBundle\'s entitlements file only when deepLinks is enabled', async () => {
    const icon = await makeSquarePng(1024);
    await repack(baseInput({ iconPng1024: icon }));

    const [, entitlementsPath] = mockSignBundle.mock.calls[0] as [string, string];
    const entitlementsXml = readFileSync(entitlementsPath, 'utf8');
    expect(entitlementsXml).toContain('applinks:cafe-mobilio.example');
    expect(entitlementsXml).toContain('ABCDE12345');
  });

  it('omits associated domains when the client config has deepLinks disabled', async () => {
    const icon = await makeSquarePng(1024);
    await repack(baseInput({ iconPng1024: icon, rawConfig: { ...VALID_CONFIG, features: { ...VALID_CONFIG.features, deepLinks: false } } }));

    const [, entitlementsPath] = mockSignBundle.mock.calls[0] as [string, string];
    const entitlementsXml = readFileSync(entitlementsPath, 'utf8');
    expect(entitlementsXml).not.toContain('applinks:');
  });

  it('leaves the base-provided splash.png untouched when splashPng is omitted', async () => {
    const icon = await makeSquarePng(1024);
    await repack(baseInput({ iconPng1024: icon }));

    const extractDir = join(root, 'verify-extract-splash');
    const { extractZip } = await import('../src/extract');
    await extractZip(outputIpaPath, extractDir);
    const splashContent = readFileSync(join(extractDir, 'Payload', 'Base.app', 'mobilio', 'splash.png'), 'utf8');
    expect(splashContent).toBe('demo splash placeholder');
  });

  it('replaces splash.png when splashPng is provided', async () => {
    const icon = await makeSquarePng(1024);
    const splash = await makeSquarePng(600);
    await repack(baseInput({ iconPng1024: icon, splashPng: splash }));

    const extractDir = join(root, 'verify-extract-splash-2');
    const { extractZip } = await import('../src/extract');
    await extractZip(outputIpaPath, extractDir);
    const splashPath = join(extractDir, 'Payload', 'Base.app', 'mobilio', 'splash.png');
    const metadata = await sharp(readFileSync(splashPath)).metadata();
    expect(metadata.width).toBe(600);
  });

  it('records a timing entry for every pipeline step, in order', async () => {
    const icon = await makeSquarePng(1024);
    const result = await repack(baseInput({ iconPng1024: icon }));

    const steps = result.timings.map((t) => t.step);
    expect(steps).toEqual([
      'checksum',
      'validateConfig',
      'extract',
      'identity',
      'icons',
      'config',
      'entitlements',
      'provisioningProfile',
      'sign',
      'verify',
      'archive',
    ]);
    for (const timing of result.timings) {
      expect(timing.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('includes a splash timing entry when splashPng is provided, right after icons', async () => {
    const icon = await makeSquarePng(1024);
    const splash = await makeSquarePng(600);
    const result = await repack(baseInput({ iconPng1024: icon, splashPng: splash }));
    const steps = result.timings.map((t) => t.step);
    expect(steps.indexOf('splash')).toBe(steps.indexOf('icons') + 1);
  });

  it('rejects with BASE_CHECKSUM_MISMATCH before extracting anything when the sha256 does not match', async () => {
    const icon = await makeSquarePng(1024);
    await expect(repack(baseInput({ iconPng1024: icon, baseSha256: 'f'.repeat(64) }))).rejects.toMatchObject({
      code: 'BASE_CHECKSUM_MISMATCH',
    });
    expect(mockSignBundle).not.toHaveBeenCalled();
  });

  it('rejects with INVALID_CONFIG before extracting anything when rawConfig fails validation', async () => {
    const icon = await makeSquarePng(1024);
    await expect(repack(baseInput({ iconPng1024: icon, rawConfig: { id: 'only-this-field' } }))).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
    });
    expect(mockSignBundle).not.toHaveBeenCalled();
  });

  it('rejects with ICON_INVALID when the icon is not exactly 1024x1024, without ever calling sign', async () => {
    const tooSmall = await makeSquarePng(512);
    await expect(repack(baseInput({ iconPng1024: tooSmall }))).rejects.toMatchObject({ code: 'ICON_INVALID' });
    expect(mockSignBundle).not.toHaveBeenCalled();
  });

  it('propagates a SIGNING_FAILED error from signBundle as-is', async () => {
    mockSignBundle.mockRejectedValueOnce(new RepackError('SIGNING_FAILED', 'rcodesign exited with code 1'));
    const icon = await makeSquarePng(1024);
    await expect(repack(baseInput({ iconPng1024: icon }))).rejects.toMatchObject({ code: 'SIGNING_FAILED' });
    expect(mockVerifyBundle).not.toHaveBeenCalled();
  });

  it('propagates a VERIFY_FAILED error from verifyBundle as-is', async () => {
    mockVerifyBundle.mockRejectedValueOnce(new RepackError('VERIFY_FAILED', 'rcodesign verify failed'));
    const icon = await makeSquarePng(1024);
    await expect(repack(baseInput({ iconPng1024: icon }))).rejects.toMatchObject({ code: 'VERIFY_FAILED' });
  });

  it('rejects with INVALID_CONFIG when the base .ipa has no Payload/*.app at all', async () => {
    const emptySourceDir = join(root, 'empty-base-source');
    mkdirSync(join(emptySourceDir, 'Payload'), { recursive: true });
    const emptyBaseIpaPath = join(root, 'empty-base.ipa');
    await createZip(emptySourceDir, emptyBaseIpaPath);
    const emptyBaseSha256 = await sha256File(emptyBaseIpaPath);

    const icon = await makeSquarePng(1024);
    await expect(
      repack(baseInput({ iconPng1024: icon, baseIpaPath: emptyBaseIpaPath, baseSha256: emptyBaseSha256 })),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
});
