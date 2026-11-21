import { readFile, writeFile } from 'node:fs/promises';
import { parseBinary, buildBinary, type PlistValue } from 'plist';
import { RepackError } from './errors.js';
import { assertValidBundleId } from './validation.js';

export type InfoPlistDict = Record<string, unknown>;

const MAX_DISPLAY_NAME_LENGTH = 30;
const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/;

export async function readInfoPlist(path: string): Promise<InfoPlistDict> {
  const raw = await readFile(path);
  return parseBinary(raw) as InfoPlistDict;
}

export async function writeInfoPlist(path: string, plist: InfoPlistDict): Promise<void> {
  const binary = buildBinary(plist as PlistValue);
  await writeFile(path, binary);
}

/**
 * Trims, then rejects anything still invalid rather than silently truncating or
 * stripping characters — a caller passing a bad name should see INVALID_CONFIG, not
 * a quietly-mangled display name.
 */
function sanitizeDisplayName(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) {
    throw new RepackError('INVALID_CONFIG', 'displayName must not be empty (after trimming)');
  }
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new RepackError(
      'INVALID_CONFIG',
      `displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} characters, got ${trimmed.length}`,
    );
  }
  if (CONTROL_CHAR_PATTERN.test(trimmed)) {
    throw new RepackError('INVALID_CONFIG', 'displayName must not contain control characters');
  }
  return trimmed;
}

/** A custom URL scheme for the client's own deep links — reverse-DNS dots aren't valid in a URL scheme, so bundleId becomes bundleId-with-hyphens. */
function urlSchemeForBundleId(bundleId: string): string {
  return bundleId.replace(/\./g, '-');
}

export type ClientIdentity = {
  bundleId: string;
  displayName: string;
  shortVersion: string;
  buildNumber: string;
};

/**
 * Pure, snapshot-testable: everything applyClientIdentity does to the plist, with no
 * filesystem I/O. CFBundleIconName must stay absent afterward — if some unrelated
 * edit upstream (or a future change to this function) ever reintroduced it, the base
 * .app's own CFBundleIconFiles mechanism (withMobilioIcons.js) would silently stop
 * being what iOS actually uses for the app icon.
 */
export function applyClientIdentity(plist: InfoPlistDict, identity: ClientIdentity): InfoPlistDict {
  assertValidBundleId(identity.bundleId);
  const displayName = sanitizeDisplayName(identity.displayName);

  const next: InfoPlistDict = {
    ...plist,
    CFBundleIdentifier: identity.bundleId,
    CFBundleDisplayName: displayName,
    CFBundleName: displayName,
    CFBundleShortVersionString: identity.shortVersion,
    CFBundleVersion: identity.buildNumber,
    CFBundleURLTypes: [
      {
        CFBundleURLName: identity.bundleId,
        CFBundleURLSchemes: [urlSchemeForBundleId(identity.bundleId)],
      },
    ],
  };

  if ('CFBundleIconName' in next) {
    throw new RepackError(
      'INVALID_CONFIG',
      'CFBundleIconName must stay absent — the base .app uses CFBundleIconFiles, not an asset-catalog icon',
    );
  }

  return next;
}
