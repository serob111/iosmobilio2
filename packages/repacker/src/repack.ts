import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectConfig } from '@mobilio/config';
import { createZip } from './archive.js';
import { assertBaseChecksum } from './checksum.js';
import { validateProjectConfig, writeConfigJson } from './config-bundle.js';
import { buildEntitlements, writeEntitlements } from './entitlements.js';
import { RepackError } from './errors.js';
import { extractZip } from './extract.js';
import { generateIcons } from './icons.js';
import { applyClientIdentity, readInfoPlist, writeInfoPlist } from './info-plist.js';
import { embedProvisioningProfile } from './provisioning.js';
import type { RcodesignConfig, SigningCredentials } from './sign.js';
import { signBundle, verifyBundle } from './sign.js';
import { generateSplash } from './splash.js';

export type RepackInput = {
  /** Path to a base .ipa already fetched to local disk by the caller (e.g. the worker, from shell_releases' S3 object). */
  baseIpaPath: string;
  /** The shell_releases row's own recorded sha256 — checked against baseIpaPath before anything else runs. */
  baseSha256: string;
  /** Scratch directory for extraction; repack owns and deletes its contents, but not the directory itself. */
  workDir: string;
  /** Where the final, signed .ipa is written. */
  outputIpaPath: string;
  /** Validated via validateProjectConfig before any other step runs. */
  rawConfig: unknown;
  /** Exactly 1024x1024, no alpha — see icons.ts. */
  iconPng1024: Buffer;
  /** Optional — when omitted, the base's own bundled splash.png is left as-is. */
  splashPng?: Buffer;
  bundleId: string;
  displayName: string;
  shortVersion: string;
  buildNumber: string;
  /**
   * Resolved by the caller (packages/apple, a later phase) from the client's own App
   * ID / provisioning profile — this package never parses the profile's own PKCS#7
   * envelope to extract it, see provisioning.ts.
   */
  teamId: string;
  /** Raw bytes of the already-issued provisioning profile, embedded verbatim. */
  provisioningProfile: Buffer;
  signing: SigningCredentials;
  rcodesign: RcodesignConfig;
};

export type RepackStepTiming = { step: string; durationMs: number };

export type RepackResult = {
  outputIpaPath: string;
  timings: RepackStepTiming[];
};

async function timed<T>(timings: RepackStepTiming[], step: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    timings.push({ step, durationMs: performance.now() - start });
  }
}

/** The base .ipa always has exactly one Payload/*.app — base-build.yml's own archive step guarantees this, not something repack needs to tolerate deviating from. */
async function findAppDir(extractDir: string): Promise<string> {
  const payloadDir = join(extractDir, 'Payload');
  let entries: string[];
  try {
    entries = await readdir(payloadDir);
  } catch (error) {
    throw new RepackError('INVALID_CONFIG', `base .ipa has no Payload directory at ${payloadDir}`, error);
  }
  const appNames = entries.filter((name) => name.endsWith('.app'));
  const appName = appNames[0];
  if (appNames.length !== 1 || !appName) {
    throw new RepackError(
      'INVALID_CONFIG',
      `expected exactly one .app in Payload, found ${appNames.length} (${appNames.join(', ')})`,
    );
  }
  return join(payloadDir, appName);
}

/** applinks: per-domain associated domains only when the client has deep links enabled — see entitlements.ts's own EntitlementsInput doc comment. */
function resolveAssociatedDomains(config: ProjectConfig): string[] {
  return config.features.deepLinks ? config.allowedDomains : [];
}

/**
 * Wires every repacker module into the full base-.ipa-to-signed-.ipa pipeline:
 * checksum the base, extract, edit identity/icons/splash/config/entitlements/profile,
 * sign, verify, re-zip. Each step is timed independently so a caller (the worker) can
 * see which stage a slow or failing repack spent its time in, without needing to
 * instrument every module itself.
 */
export async function repack(input: RepackInput): Promise<RepackResult> {
  const timings: RepackStepTiming[] = [];
  const extractDir = join(input.workDir, 'extracted');

  await rm(extractDir, { recursive: true, force: true });
  await mkdir(input.workDir, { recursive: true });

  await timed(timings, 'checksum', () => assertBaseChecksum(input.baseIpaPath, input.baseSha256));

  const config = await timed(timings, 'validateConfig', () => Promise.resolve(validateProjectConfig(input.rawConfig)));

  await timed(timings, 'extract', () => extractZip(input.baseIpaPath, extractDir));

  const appDir = await findAppDir(extractDir);
  const infoPlistPath = join(appDir, 'Info.plist');

  await timed(timings, 'identity', async () => {
    const plist = await readInfoPlist(infoPlistPath);
    const next = applyClientIdentity(plist, {
      bundleId: input.bundleId,
      displayName: input.displayName,
      shortVersion: input.shortVersion,
      buildNumber: input.buildNumber,
    });
    await writeInfoPlist(infoPlistPath, next);
  });

  await timed(timings, 'icons', () => generateIcons(input.iconPng1024, appDir, config.theme.background));

  if (input.splashPng) {
    await timed(timings, 'splash', () => generateSplash(input.splashPng!, join(appDir, 'mobilio', 'splash.png')));
  }

  await timed(timings, 'config', () => writeConfigJson(join(appDir, 'mobilio'), config));

  const entitlementsPath = join(input.workDir, 'entitlements.plist');
  await timed(timings, 'entitlements', async () => {
    const entitlements = buildEntitlements({
      teamId: input.teamId,
      bundleId: input.bundleId,
      associatedDomains: resolveAssociatedDomains(config),
    });
    await writeEntitlements(entitlementsPath, entitlements);
  });

  await timed(timings, 'provisioningProfile', () => embedProvisioningProfile(appDir, input.provisioningProfile));

  await timed(timings, 'sign', () => signBundle(appDir, entitlementsPath, input.signing, input.rcodesign));

  await timed(timings, 'verify', async () => {
    const plist = await readInfoPlist(infoPlistPath);
    const executableName = plist.CFBundleExecutable;
    if (typeof executableName !== 'string' || executableName.length === 0) {
      throw new RepackError('VERIFY_FAILED', 'Info.plist has no CFBundleExecutable to verify after signing');
    }
    await verifyBundle(join(appDir, executableName), input.rcodesign);
  });

  await timed(timings, 'archive', () => createZip(extractDir, input.outputIpaPath));

  return { outputIpaPath: input.outputIpaPath, timings };
}
